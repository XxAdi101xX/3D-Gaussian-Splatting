import { vec3, mat4, type Vec3, type Mat4 } from "wgpu-matrix";
import { PlyProcessor } from "./plyProcessor";
import { Scene } from "./scene";
import { GaussianSplats } from "./gaussianSplats";
import { Points } from "./points";

type GlobalBuffers = {
    view: GPUBuffer;
    projection: GPUBuffer;
    light: GPUBuffer;
    screenSize: GPUBuffer;
};

type StagingBuffers = {
    view: GPUBuffer;
    projection: GPUBuffer;
    light: GPUBuffer;
    screenSize: GPUBuffer;
};

export default class Renderer {
    private static readonly PLY_FILE_NAME = "chips_and_pop.ply";
    private static readonly FOV_Y = 1.4;
    private static readonly NEAR = 0.1;
    private static readonly FAR = 1000;
    private static readonly FLOATS_PER_LIGHT = 4;
    private static readonly SCREEN_SIZE_FLOATS = 4;
    private static readonly MAT4_FLOATS = 16;

    canvas: HTMLCanvasElement;
    scene: Scene;

    adapter!: GPUAdapter;
    device!: GPUDevice;
    queue!: GPUQueue;
    context!: GPUCanvasContext;
    canvasFormat!: GPUTextureFormat;

    globalBindGroupLayout!: GPUBindGroupLayout;
    globalBindGroup!: GPUBindGroup;
    renderPassDescriptor!: GPURenderPassDescriptor;

    buffers!: GlobalBuffers;
    stagingBuffers!: StagingBuffers;
    gaussianSplats!: GaussianSplats;
    points!: Points;
    lastCameraPosition!: Vec3;

    constructor(canvas: HTMLCanvasElement, scene: Scene) {
        this.canvas = canvas;
        this.scene = scene;
    }

    async start(): Promise<void> {
        const initialized = await this.initializeWebGpu();
        if (!initialized) return;

        await this.initializeResources();
        await this.renderLoop();
    }

    private async initializeWebGpu(): Promise<boolean> {
        try {
            if (!navigator.gpu) {
                console.error("WebGPU is not available or supported");
                return false;
            }

            const adapter = await navigator.gpu.requestAdapter();
            if (!adapter) {
                console.error("GPUAdapter not found");
                return false;
            }
            this.adapter = adapter;

            const device = await this.adapter.requestDevice();
            if (!device) {
                console.error("GPUDevice not found");
                return false;
            }
            this.device = device;
            this.queue = device.queue;

            const context = this.canvas.getContext("webgpu");
            if (!context) {
                console.error("GPUCanvasContext not found");
                return false;
            }
            this.context = context;

            this.canvasFormat = navigator.gpu.getPreferredCanvasFormat();
            this.context.configure({
                device: this.device,
                format: this.canvasFormat,
                usage: GPUTextureUsage.RENDER_ATTACHMENT,
                alphaMode: "opaque",
            });

            return true;
        } catch (error) {
            console.error("Failed to initialize WebGPU", error);
            return false;
        }
    }

    private async initializeResources(): Promise<void> {
        this.buffers = this.createGlobalBuffers();
        this.stagingBuffers = this.createStagingBuffers();
        this.globalBindGroupLayout = this.createGlobalBindGroupLayout();
        this.globalBindGroup = this.createGlobalBindGroup();
        this.gaussianSplats = await this.createGaussianSplats();
        this.points = await this.createPoints();
        this.renderPassDescriptor = this.createRenderPassDescriptor();
        this.lastCameraPosition = vec3.create(Infinity, Infinity, Infinity);
    }

    private createGlobalBuffers(): GlobalBuffers {
        return {
            view: this.createBuffer(
                "View Matrix Buffer",
                Renderer.MAT4_FLOATS * Float32Array.BYTES_PER_ELEMENT,
                GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
            ),
            projection: this.createBuffer(
                "Projection Matrix Buffer",
                Renderer.MAT4_FLOATS * Float32Array.BYTES_PER_ELEMENT,
                GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
            ),
            light: this.createBuffer(
                "Light Buffer",
                this.getLightBufferSize(),
                GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
            ),
            screenSize: this.createBuffer(
                "Screen Size Buffer",
                Renderer.SCREEN_SIZE_FLOATS * Float32Array.BYTES_PER_ELEMENT,
                GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
            ),
        };
    }

    private createStagingBuffers(): StagingBuffers {
        return {
            view: this.createBuffer(
                "View Matrix Staging Buffer",
                Renderer.MAT4_FLOATS * Float32Array.BYTES_PER_ELEMENT,
                GPUBufferUsage.MAP_WRITE | GPUBufferUsage.COPY_SRC
            ),
            projection: this.createBuffer(
                "Projection Matrix Staging Buffer",
                Renderer.MAT4_FLOATS * Float32Array.BYTES_PER_ELEMENT,
                GPUBufferUsage.MAP_WRITE | GPUBufferUsage.COPY_SRC
            ),
            light: this.createBuffer(
                "Light Staging Buffer",
                this.getLightBufferSize(),
                GPUBufferUsage.MAP_WRITE | GPUBufferUsage.COPY_SRC
            ),
            screenSize: this.createBuffer(
                "Screen Size Staging Buffer",
                Renderer.SCREEN_SIZE_FLOATS * Float32Array.BYTES_PER_ELEMENT,
                GPUBufferUsage.MAP_WRITE | GPUBufferUsage.COPY_SRC
            ),
        };
    }

    private createBuffer(
        label: string,
        size: number,
        usage: GPUBufferUsageFlags
    ): GPUBuffer {
        return this.device.createBuffer({
            label,
            size,
            usage,
        });
    }

    private getLightBufferSize(): number {
        return (
            this.scene.lights.length *
            Renderer.FLOATS_PER_LIGHT *
            Float32Array.BYTES_PER_ELEMENT
        );
    }

    private createGlobalBindGroupLayout(): GPUBindGroupLayout {
        return this.device.createBindGroupLayout({
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.VERTEX,
                    buffer: { type: "uniform" },
                },
                {
                    binding: 1,
                    visibility: GPUShaderStage.VERTEX,
                    buffer: { type: "uniform" },
                },
                {
                    binding: 2,
                    visibility: GPUShaderStage.VERTEX,
                    buffer: { type: "read-only-storage" },
                },
                {
                    binding: 3,
                    visibility: GPUShaderStage.VERTEX,
                    buffer: { type: "uniform" },
                },
            ],
        });
    }

    private createGlobalBindGroup(): GPUBindGroup {
        return this.device.createBindGroup({
            layout: this.globalBindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.buffers.view } },
                { binding: 1, resource: { buffer: this.buffers.projection } },
                { binding: 2, resource: { buffer: this.buffers.light } },
                { binding: 3, resource: { buffer: this.buffers.screenSize } },
            ],
        });
    }

    private async createGaussianSplats(): Promise<GaussianSplats> {
        const response = await fetch(`./assets/${Renderer.PLY_FILE_NAME}`);
        const blob = await response.blob();
        const file = new File([blob], Renderer.PLY_FILE_NAME);

        const parser = new PlyProcessor();
        await parser.parsePlyFileAndPopulateGaussianSplats(file);

        return new GaussianSplats(
            this.device,
            parser.getGaussianSplats(),
            this.globalBindGroupLayout,
            this.canvasFormat
        );
    }

    private async createPoints(): Promise<Points> {
        // const pointsResponse = await fetch('./assets/points.json');
        // const pointsData = await pointsResponse.json();
        const response = await fetch(`./assets/${Renderer.PLY_FILE_NAME}`);
        const blob = await response.blob();
        const file = new File([blob], Renderer.PLY_FILE_NAME);

        const parser = new PlyProcessor();
        await parser.parsePlyFileAndPopulateGaussianSplats(file);

        return new Points(
            this.device,
            parser.getGaussianSplats(),
            this.globalBindGroupLayout,
            this.canvasFormat
        );
    }

    private createRenderPassDescriptor(): GPURenderPassDescriptor {
        return {
            colorAttachments: [
                {
                    view: this.context.getCurrentTexture().createView(),
                    loadOp: "clear",
                    clearValue: { r: 0, g: 0, b: 0, a: 1 },
                    storeOp: "store",
                },
            ],
        };
    }

    private getProjectionMatrix(): Mat4 {
        return mat4.perspective(
            Renderer.FOV_Y,
            this.canvas.width / this.canvas.height,
            Renderer.NEAR,
            Renderer.FAR
        );
    }

    private updateCameraTracking(): boolean {
        if (vec3.equalsApproximately(this.lastCameraPosition, this.scene.camera.position)) {
            return false;
        }

        this.lastCameraPosition = vec3.clone(this.scene.camera.position);
        return true;
    }

    private async updateGlobalStagingBuffers(
        viewMatrix: Mat4,
        projectionMatrix: Mat4
    ): Promise<void> {
        await this.writeToStagingBuffer(this.stagingBuffers.view, viewMatrix);
        await this.writeToStagingBuffer(this.stagingBuffers.projection, projectionMatrix);
        await this.writeToStagingBuffer(this.stagingBuffers.light, this.getLightData());
        await this.writeToStagingBuffer(
            this.stagingBuffers.screenSize,
            this.getScreenSizeData()
        );
    }

    private async writeToStagingBuffer(
        buffer: GPUBuffer,
        data: Float32Array<ArrayBufferLike>
    ): Promise<void> {
        await buffer.mapAsync(GPUMapMode.WRITE);
        new Float32Array(buffer.getMappedRange()).set(data);
        buffer.unmap();
    }

    private getLightData(): Float32Array {
        const lightData = new Float32Array(
            this.scene.lights.length * Renderer.FLOATS_PER_LIGHT
        );

        for (let i = 0; i < this.scene.lights.length; i++) {
            const light = this.scene.lights[i];
            const offset = i * Renderer.FLOATS_PER_LIGHT;

            lightData[offset + 0] = light.position[0];
            lightData[offset + 1] = light.position[1];
            lightData[offset + 2] = light.position[2];
            lightData[offset + 3] = light.padding;
        }

        return lightData;
    }

    private getScreenSizeData(): Float32Array {
        return new Float32Array([this.canvas.width, this.canvas.height, 0, 0]);
    }

    private copyGlobalBuffers(commandEncoder: GPUCommandEncoder): void {
        commandEncoder.copyBufferToBuffer(
            this.stagingBuffers.view,
            0,
            this.buffers.view,
            0,
            Renderer.MAT4_FLOATS * Float32Array.BYTES_PER_ELEMENT
        );

        commandEncoder.copyBufferToBuffer(
            this.stagingBuffers.projection,
            0,
            this.buffers.projection,
            0,
            Renderer.MAT4_FLOATS * Float32Array.BYTES_PER_ELEMENT
        );

        commandEncoder.copyBufferToBuffer(
            this.stagingBuffers.light,
            0,
            this.buffers.light,
            0,
            this.getLightBufferSize()
        );

        commandEncoder.copyBufferToBuffer(
            this.stagingBuffers.screenSize,
            0,
            this.buffers.screenSize,
            0,
            Renderer.SCREEN_SIZE_FLOATS * Float32Array.BYTES_PER_ELEMENT
        );
    }

    private updateCurrentRenderTarget(): void {
        const colorAttachment = this
            .renderPassDescriptor.colorAttachments?.[0] as GPURenderPassColorAttachment;

        colorAttachment.view = this.context.getCurrentTexture().createView();
    }

    private updatePerformanceLabel(frameRenderStart: number): void {
        const performanceLabel = document.getElementById("render-time");
        if (!performanceLabel) return;

        const frameRenderEnd = performance.now();
        performanceLabel.innerText = (frameRenderEnd - frameRenderStart).toFixed(2);
    }

    private renderLoop = async (): Promise<void> => {
        const frameRenderStart = performance.now();

        const viewMatrix = this.scene.camera.getViewMatrix();
        const projectionMatrix = this.getProjectionMatrix();
        const shouldUpdateOrder = this.updateCameraTracking();

        await this.updateGlobalStagingBuffers(viewMatrix, projectionMatrix);
        this.updateCurrentRenderTarget();

        const commandEncoder = this.device.createCommandEncoder();
        this.copyGlobalBuffers(commandEncoder);

        const basisUpdateBuffer = this.gaussianSplats.updateBasisBuffer(
            this.device,
            projectionMatrix,
            viewMatrix,
            this.canvas,
            commandEncoder
        );

        let splatIndexBuffer: GPUBuffer | null = null;
        if (shouldUpdateOrder) {
            splatIndexBuffer = this.gaussianSplats.updateSplatIndexBuffer(
                this.device,
                projectionMatrix,
                viewMatrix,
                commandEncoder
            );
        }

        const renderPass = commandEncoder.beginRenderPass(this.renderPassDescriptor);
        this.gaussianSplats.render(renderPass, this.globalBindGroup);
        // this.points.render(renderPass, this.globalBindGroup);
        renderPass.end();

        this.queue.submit([commandEncoder.finish()]);

        this.queue.onSubmittedWorkDone().then(() => {
            basisUpdateBuffer.destroy();
            splatIndexBuffer?.destroy();
            this.updatePerformanceLabel(frameRenderStart);
        });

        requestAnimationFrame(this.renderLoop);
    };

    cleanup(): void {
        this.buffers.view.destroy();
        this.buffers.projection.destroy();
        this.buffers.light.destroy();
        this.buffers.screenSize.destroy();

        this.stagingBuffers.view.destroy();
        this.stagingBuffers.projection.destroy();
        this.stagingBuffers.light.destroy();
        this.stagingBuffers.screenSize.destroy();
    }
}