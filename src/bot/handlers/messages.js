/**
 * Message handler.
 * Streams the text reply, then optionally directs and generates one image.
 */

import {
    IMAGE_GENERATION_AVAILABLE,
    COMFYUI_CHECKPOINT_NAME,
    MAX_MESSAGE_LENGTH,
    OLLAMA_MODEL,
    TELEGRAM_STREAM_EDIT_INTERVAL_MS,
} from "../../config/index.js";
import { PERSONALITIES } from "../../personalities/index.js";
import { buildMemoryKeyboard } from "../utils/keyboards.js";
import { isOwner, replyNotOwner } from "../middleware/ownerCheck.js";
import {
    getChatState,
    appendChatArtifact,
    appendChatMessage,
    loadRecentConversation,
    loadSmartMemory,
    getLongTermMemoryForPrompt,
    smartSaveMessage,
    updateMemoryEntry,
} from "../../memory/index.js";
import { getMemoryAccessLabel, hasMemoryAccess } from "../../memory/access.js";
import {
    aiClient,
    conversationQueue,
    imagePipeline,
    imagePreferences,
} from "../../image/runtime.js";
import { ImageQueueFullError } from "../../image/errors.js";
import {
    IMAGE_BUILDING_MESSAGE,
    buildImageCaption,
    imageGenerationErrorMessage,
} from "../../image/telegram.js";
import { getPendingMemoryEdit, deletePendingMemoryEdit } from "./actions.js";

const STREAM_EDIT_DELAY_SEQUENCE_MS = [
    TELEGRAM_STREAM_EDIT_INTERVAL_MS,
    TELEGRAM_STREAM_EDIT_INTERVAL_MS,
    TELEGRAM_STREAM_EDIT_INTERVAL_MS * 2,
    20000,
];

export function formatModelDisplayName(value, maxWords = 4) {
    const filename = String(value || "")
        .trim()
        .split(/[\\/]/)
        .at(-1)
        .replace(/\.(?:safetensors|ckpt|gguf)$/i, "");
    const colonParts = filename.split(":");
    if (/^q\d/i.test(colonParts.at(-1))) colonParts.pop();

    const words = colonParts
        .join(" ")
        .replace(/[-_]+/g, " ")
        .split(/\s+/)
        .filter((word) => word && !/^gguf$/i.test(word) && !/^q\d/i.test(word));
    return words.slice(0, maxWords).join(" ") || "Unknown";
}

export function buildProcessingMessage({
    personalityName,
    memoryEnabled,
    imageEnabled,
    textModel = OLLAMA_MODEL,
    imageModel = COMFYUI_CHECKPOINT_NAME,
}) {
    const textLabel = formatModelDisplayName(textModel);
    const imageLabel = imageEnabled
        ? formatModelDisplayName(imageModel)
        : "Off";
    const character = String(personalityName || "Unknown").replace(/\s+/g, " ");

    return [
        "⏳ Processing...",
        `💬 Text→Text: ${textLabel}`,
        `🎨 Text→Image: ${imageLabel}`,
        `🎭 ${character} · Memory ${memoryEnabled ? "on" : "off"}`,
    ].join("\n");
}

function formatSeconds(milliseconds) {
    return `${(Math.max(0, milliseconds || 0) / 1000).toFixed(2)}s`;
}

function logPipelineTimings({
    username,
    userId,
    messageTimings,
    imageTimings,
    totalToPhotoMs,
    totalWithCleanupMs,
}) {
    console.log(
        [
            `⏱️ Pipeline timing for ${username} (${userId})`,
            `   Request setup: ${formatSeconds(messageTimings.requestSetupMs)}`,
            `   Queue wait: ${formatSeconds(messageTimings.queueWaitMs)}`,
            `   Text-model preparation: ${formatSeconds(messageTimings.textModelPreparationMs)}`,
            `   Context and memory: ${formatSeconds(messageTimings.contextPreparationMs)}`,
            `   Text generation: ${formatSeconds(messageTimings.textGenerationMs)}`,
            `   Text delivery: ${formatSeconds(messageTimings.textDeliveryMs)}`,
            `   Scene direction: ${formatSeconds(imageTimings.sceneDirectionMs)}`,
            `   Prompt persistence: ${formatSeconds(imageTimings.promptPersistenceMs)}`,
            `   Text-model unload: ${formatSeconds(imageTimings.textModelUnloadMs)}`,
            `   Image status: ${formatSeconds(imageTimings.imageStatusMs)}`,
            `   Image generation: ${formatSeconds(imageTimings.imageGenerationMs)}`,
            `   Image delivery: ${formatSeconds(imageTimings.imageDeliveryMs)}`,
            `   Image-model unload: ${formatSeconds(imageTimings.imageModelUnloadMs)}`,
            `   Text-model reload: ${formatSeconds(imageTimings.textModelReloadMs)}`,
            `   Image pipeline total: ${formatSeconds(imageTimings.totalMs)}`,
            `   Total until photo: ${formatSeconds(totalToPhotoMs)}`,
            `   Total with cleanup: ${formatSeconds(totalWithCleanupMs)}`,
        ].join("\n"),
    );
}

function splitTelegramMessage(text) {
    return text.match(new RegExp(`.{1,${MAX_MESSAGE_LENGTH}}`, "gs")) || [text];
}

function getEditablePreview(text) {
    const trimmed = text.trim();
    if (!trimmed) return "";
    if (trimmed.length <= MAX_MESSAGE_LENGTH) return trimmed;
    return `${trimmed.slice(0, MAX_MESSAGE_LENGTH - 24)}\n\n...streaming`;
}

async function editMessageSafely(ctx, messageId, text) {
    if (!messageId || !text.trim()) return false;

    try {
        await ctx.telegram.editMessageText(
            ctx.chat.id,
            messageId,
            undefined,
            getEditablePreview(text),
        );
        return true;
    } catch (error) {
        const description = error.description || error.message || "";
        if (description.includes("message is not modified")) return true;
        console.warn("⚠️ Could not edit Telegram message:", error.message);
        return false;
    }
}

async function deleteMessageSafely(ctx, messageId) {
    if (!messageId) return;
    try {
        await ctx.deleteMessage(messageId);
    } catch (error) {
        console.warn("⚠️ Could not delete Telegram status message:", error.message);
    }
}

async function sendFinalResponse(ctx, processingMessage, response) {
    const messages = splitTelegramMessage(response.trim());

    if (processingMessage?.message_id) {
        const edited = await editMessageSafely(
            ctx,
            processingMessage.message_id,
            messages[0],
        );
        if (!edited) {
            await deleteMessageSafely(ctx, processingMessage.message_id);
            await ctx.reply(messages[0]);
        }
    } else {
        await ctx.reply(messages[0]);
    }

    for (const chunk of messages.slice(1)) {
        await ctx.reply(chunk);
    }
}

async function sendAutomaticImage(
    ctx,
    response,
    characterSystemPrompt,
    username,
    userId,
) {
    let imageStatusMessage = null;
    let caption = "";
    let photoDeliveredAt = null;

    try {
        const result = await imagePipeline.run({
            latestAssistantResponse: response,
            characterSystemPrompt,
            onPromptReady: async (scenePrompt) => {
                caption = buildImageCaption(scenePrompt);
                await appendChatArtifact(
                    ctx.chat.id,
                    "Scene Director",
                    scenePrompt,
                );
                await imagePreferences.recordScenePrompt({
                    user: ctx.from,
                    chatId: ctx.chat.id,
                    assistantResponse: response,
                    scenePrompt,
                });
            },
            onGenerationStart: async () => {
                imageStatusMessage = await ctx.reply(IMAGE_BUILDING_MESSAGE);
            },
            onImageReady: async ({ buffer }) => {
                try {
                    await ctx.sendChatAction("upload_photo");
                } catch {}
                await deleteMessageSafely(
                    ctx,
                    imageStatusMessage?.message_id,
                );
                await ctx.replyWithPhoto(
                    { source: buffer },
                    { caption, parse_mode: "HTML" },
                );
                photoDeliveredAt = Date.now();
            },
        });
        console.log(`✅ Sent automatic image to ${username} (${userId})`);
        return { ...result, photoDeliveredAt };
    } catch (error) {
        console.error(
            `❌ Automatic image failed for ${username} (${userId}): ${error.message}`,
        );
        if (error.imageDelivered) {
            return {
                timings: error.pipelineTimings,
                photoDeliveredAt,
                recoveryFailed: true,
            };
        }

        const message = imageGenerationErrorMessage(error);
        if (imageStatusMessage?.message_id) {
            const edited = await editMessageSafely(
                ctx,
                imageStatusMessage.message_id,
                message,
            );
            if (edited) return;
        }
        await ctx.reply(message);
        return null;
    }
}

async function processConversation({
    ctx,
    processingMessage,
    userMessage,
    username,
    userId,
    imageEnabled,
    personality,
    memoryAccess,
    receivedAt,
    queuedAt,
}) {
    const processingStartedAt = Date.now();
    const messageTimings = {
        requestSetupMs: queuedAt - receivedAt,
        queueWaitMs: processingStartedAt - queuedAt,
        textModelPreparationMs: 0,
        contextPreparationMs: 0,
        textGenerationMs: 0,
        textDeliveryMs: 0,
    };

    let phaseStartedAt = Date.now();
    if (imageEnabled || !imagePipeline.textModelReady) {
        await imagePipeline.ensureTextModelReady();
    }
    messageTimings.textModelPreparationMs = Date.now() - phaseStartedAt;

    phaseStartedAt = Date.now();
    const recentHistory = await loadRecentConversation(ctx.chat.id);
    const memoryContext = memoryAccess
        ? await getLongTermMemoryForPrompt(ctx.chat.id, 30)
        : "";

    await appendChatMessage(ctx.chat.id, "user", userMessage);
    if (memoryAccess) {
        const userSaved = await smartSaveMessage(
            ctx.chat.id,
            "user",
            userMessage,
        );
        console.log(
            `🧠 Short-term memory queue: ${userSaved ? "saved" : "skipped"}`,
        );
    }
    messageTimings.contextPreparationMs = Date.now() - phaseStartedAt;

    await ctx.sendChatAction("typing");
    let nextEditAt = 0;
    let editDelayIndex = 0;
    let lastEditedText = "";

    phaseStartedAt = Date.now();
    const response = await aiClient.chatStream(
        userMessage,
        personality,
        recentHistory,
        memoryContext,
        async (partialText) => {
            const now = Date.now();
            const preview = getEditablePreview(partialText);
            if (!preview || preview === lastEditedText || now < nextEditAt) return;

            const edited = await editMessageSafely(
                ctx,
                processingMessage.message_id,
                preview,
            );
            if (edited) {
                lastEditedText = preview;
                editDelayIndex = Math.min(
                    editDelayIndex + 1,
                    STREAM_EDIT_DELAY_SEQUENCE_MS.length - 1,
                );
                nextEditAt = now + STREAM_EDIT_DELAY_SEQUENCE_MS[editDelayIndex];
                await ctx.sendChatAction("typing");
            }
        },
    );
    messageTimings.textGenerationMs = Date.now() - phaseStartedAt;

    if (!response) {
        await deleteMessageSafely(ctx, processingMessage?.message_id);
        await ctx.reply(
            "❌ I couldn't process your request. Please make sure Ollama is running and try again.",
        );
        return;
    }

    phaseStartedAt = Date.now();
    await appendChatMessage(
        ctx.chat.id,
        "assistant",
        response,
        personality.name,
    );
    await sendFinalResponse(ctx, processingMessage, response);
    messageTimings.textDeliveryMs = Date.now() - phaseStartedAt;
    console.log(`✅ Sent response to ${username} (${userId})`);

    if (imageEnabled) {
        const imageResult = await sendAutomaticImage(
            ctx,
            response,
            personality.prompt,
            username,
            userId,
        );
        if (imageResult?.photoDeliveredAt) {
            logPipelineTimings({
                username,
                userId,
                messageTimings,
                imageTimings: imageResult.timings,
                totalToPhotoMs: imageResult.photoDeliveredAt - receivedAt,
                totalWithCleanupMs: Date.now() - receivedAt,
            });
        }
    }
}

function startBackgroundTask(promise, ctx, processingMessage) {
    void promise.catch(async (error) => {
        console.error(`❌ Error processing queued message: ${error.message}`);
        const message = "❌ Something unexpected happened. Please try again.";
        const edited = await editMessageSafely(
            ctx,
            processingMessage?.message_id,
            message,
        );
        if (!edited) await ctx.reply(message);
    });
}
export function registerMessageHandler(bot) {
    bot.on("message", async (ctx, next) => {
        if (!ctx.message?.text) return;

        const userId = ctx.from?.id;
        const editId = getPendingMemoryEdit(ctx.chat.id, userId);
        const text = ctx.message.text.trim();

        if (!editId) {
            if (text.startsWith("/")) return;
            return next();
        }

        if (!isOwner(ctx)) return replyNotOwner(ctx);

        if (text.toLowerCase() === "cancel" || text.toLowerCase() === "لغو") {
            deletePendingMemoryEdit(ctx.chat.id, userId);
            await ctx.reply("✋ Memory edit canceled.");
            return;
        }
        if (text.startsWith("/")) return;

        const chatState = await getChatState(ctx.chat.id);
        const personality =
            PERSONALITIES[chatState.personality] ||
            PERSONALITIES[Object.keys(PERSONALITIES)[0]];
        if (!hasMemoryAccess(personality)) {
            deletePendingMemoryEdit(ctx.chat.id, userId);
            await ctx.reply(
                `🧠 Memory editing is only enabled for ${getMemoryAccessLabel()}. Current personality: ${personality.name}.`,
            );
            return;
        }

        const updated = await updateMemoryEntry(ctx.chat.id, editId, text);
        deletePendingMemoryEdit(ctx.chat.id, userId);
        if (updated) {
            await ctx.reply("✅ Memory entry updated.");
            const memoryEntries = await loadSmartMemory(ctx.chat.id, [], 10);
            await ctx.reply(
                "📝 Here is your updated memory list:",
                buildMemoryKeyboard(memoryEntries),
            );
        } else {
            await ctx.reply(
                "⚠️ Could not update the memory entry. It may no longer exist.",
            );
        }
    });

    bot.on("message", async (ctx) => {
        if (!ctx.message?.text) return;
        if (!isOwner(ctx)) return replyNotOwner(ctx);
        if (ctx.message.text.startsWith("/")) return;

        const userId = Number(ctx.from.id);
        const username = ctx.from.username || "Unknown";
        const userMessage = ctx.message.text.trim();
        const receivedAt = Date.now();
        console.log("-".repeat(50));
        console.log(`💬 Message from ${username} (${userId}): ${userMessage}`);

        const imageEnabled =
            IMAGE_GENERATION_AVAILABLE &&
            (await imagePreferences.getPreference(ctx.from));
        const chatState = await getChatState(ctx.chat.id);
        const personality =
            PERSONALITIES[chatState.personality] ||
            PERSONALITIES[Object.keys(PERSONALITIES)[0]];
        const memoryAccess = hasMemoryAccess(personality);
        const processingMessage = await ctx.reply(
            buildProcessingMessage({
                personalityName: personality.name,
                memoryEnabled: memoryAccess,
                imageEnabled,
            }),
        );
        const queuedAt = Date.now();

        let queued;
        try {
            queued = conversationQueue.add(() =>
                processConversation({
                    ctx,
                    processingMessage,
                    userMessage,
                    username,
                    userId,
                    imageEnabled,
                    personality,
                    memoryAccess,
                    receivedAt,
                    queuedAt,
                }),
            );
        } catch (error) {
            await deleteMessageSafely(ctx, processingMessage.message_id);
            if (error instanceof ImageQueueFullError) {
                await ctx.reply(
                    "⏳ Too many messages are already waiting. Please try again after the current reply finishes.",
                );
                return;
            }
            throw error;
        }

        startBackgroundTask(queued.promise, ctx, processingMessage);
    });
}
