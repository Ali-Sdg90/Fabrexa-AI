export class ImagePipeline {
    constructor({
        aiClient,
        sceneDirector,
        comfyUIService,
        seedGenerator,
        now = Date.now,
    }) {
        this.aiClient = aiClient;
        this.sceneDirector = sceneDirector;
        this.comfyUIService = comfyUIService;
        this.seedGenerator = seedGenerator;
        this.now = now;
        this.textModelReady = true;
        this.initialPreparationDone = false;
    }

    async initialize() {
        await Promise.all([
            this.sceneDirector.initialize(),
            this.comfyUIService.initialize(),
        ]);
    }

    async ensureTextModelReady() {
        if (this.textModelReady && this.initialPreparationDone) return;
        await this.comfyUIService.releaseModelsForTextInference();
        await this.aiClient.loadModelAndWait();
        this.textModelReady = true;
        this.initialPreparationDone = true;
    }

    async run({
        latestAssistantResponse,
        characterAppearance,
        onPromptReady,
        onGenerationStart,
        onImageReady,
    }) {
        const pipelineStartedAt = this.now();
        const timings = {
            sceneDirectionMs: 0,
            promptPersistenceMs: 0,
            textModelUnloadMs: 0,
            imageStatusMs: 0,
            imageGenerationMs: 0,
            imageDeliveryMs: 0,
            imageModelUnloadMs: 0,
            textModelReloadMs: 0,
            totalMs: 0,
        };

        let phaseStartedAt = this.now();
        const scenePrompt =
            await this.sceneDirector.createFromAppearanceAndLatestResponse(
                latestAssistantResponse,
                characterAppearance,
            );
        timings.sceneDirectionMs = this.now() - phaseStartedAt;

        // Persist the complete direction before unloading the text model so a
        // failed record never starts the GPU handoff.
        phaseStartedAt = this.now();
        await onPromptReady(scenePrompt);
        timings.promptPersistenceMs = this.now() - phaseStartedAt;

        phaseStartedAt = this.now();
        await this.aiClient.unloadModelAndWait();
        timings.textModelUnloadMs = this.now() - phaseStartedAt;
        this.textModelReady = false;

        let primaryError = null;
        let imageDelivered = false;
        let result;
        try {
            phaseStartedAt = this.now();
            await onGenerationStart(scenePrompt);
            timings.imageStatusMs = this.now() - phaseStartedAt;

            phaseStartedAt = this.now();
            result = await this.comfyUIService.generate(
                scenePrompt,
                this.seedGenerator(),
            );
            timings.imageGenerationMs = this.now() - phaseStartedAt;

            phaseStartedAt = this.now();
            await onImageReady({ ...result, scenePrompt });
            timings.imageDeliveryMs = this.now() - phaseStartedAt;
            imageDelivered = true;
        } catch (error) {
            primaryError = error;
        }

        let recoveryError = null;
        try {
            // This intentionally runs after Telegram delivery: the image model
            // is unloaded first, then the same text model is preloaded again.
            phaseStartedAt = this.now();
            await this.comfyUIService.releaseModelsForTextInference();
            timings.imageModelUnloadMs = this.now() - phaseStartedAt;

            phaseStartedAt = this.now();
            await this.aiClient.loadModelAndWait();
            timings.textModelReloadMs = this.now() - phaseStartedAt;
            this.textModelReady = true;
            this.initialPreparationDone = true;
        } catch (error) {
            recoveryError = error;
        }

        if (primaryError) throw primaryError;
        if (recoveryError) {
            timings.totalMs = this.now() - pipelineStartedAt;
            recoveryError.imageDelivered = imageDelivered;
            recoveryError.pipelineTimings = Object.freeze(timings);
            throw recoveryError;
        }
        timings.totalMs = this.now() - pipelineStartedAt;
        return { ...result, scenePrompt, timings: Object.freeze(timings) };
    }
}

