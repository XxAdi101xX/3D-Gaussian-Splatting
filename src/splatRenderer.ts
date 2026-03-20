import { mat4, type Mat4 } from "wgpu-matrix";
import { PlyProcessor } from "./plyProcessor";
import { Points } from "./points";
import { Scene } from "./scene";

export default class SplatRenderer {
    plyFileName = "food.ply"; // This file is assumed to be located under the assets 
    canvas: HTMLCanvasElement;
    scene: Scene;

    // WebGPU Data Structures
    adapter!: GPUAdapter;
    device!: GPUDevice;
    queue!: GPUQueue;
    context!: GPUCanvasContext;

    // Resources
    projectionViewBuffer!: GPUBuffer;
    lightBuffer!: GPUBuffer;
    globalBindGroupLayout!: GPUBindGroupLayout;
    globalBindGroup!: GPUBindGroup;
    renderPassDescriptor!: GPURenderPassDescriptor;
    points!: Points;


    constructor(canvas: HTMLCanvasElement, scene: Scene) {
        this.scene = scene;
        this.canvas = canvas;
    }

    async start() {
        if (await this.initializeWebGpu()) {
            await this.initializeResources();
            this.renderLoop();
        }
    }

    private async initializeWebGpu(): Promise<boolean> {
        try {
            const webGpuEntry: GPU = navigator.gpu;
            if (!webGpuEntry) {
                console.error("WebGPU is not available or supported");
                return false;
            }

            // Physical Device Adapter
            const adapter = await webGpuEntry.requestAdapter();
            if (!adapter) {
                console.error("GPUAdaptor not found");
                return false;
            }
            this.adapter = adapter;

            // Logical Device
            const device = await this.adapter.requestDevice();
            if (!device) {
                console.error("GPUDevice not found");
                return false;
            }
            this.device = device;

            // Debugging
            // this.device.addEventListener('uncapturederror', (event) => {
            //     console.error('WebGPU uncaptured error:', event.error.message);
            // });

            // GPU Queue
            this.queue = this.device.queue;

            // Getting and configuring the GPU canvas context
            const context = this.canvas.getContext('webgpu');
            if (!context) {
                console.error("GPUCanvasContext not found");
                return false;
            }
            this.context = context;

            const canvasConfig: GPUCanvasConfiguration = {
                device: this.device,
                format: navigator.gpu.getPreferredCanvasFormat(),
                usage: GPUTextureUsage.RENDER_ATTACHMENT,
                alphaMode: 'opaque',
            };
            this.context.configure(canvasConfig);

            return true;
        } catch (e) {
            console.error(e);
            return false;
        }
    }

    private async initializeResources() {
        // Create global buffers
        const projectionViewBufferDescriptor: GPUBufferDescriptor = {
            label: "ProjectionView",
            size: Float32Array.BYTES_PER_ELEMENT * 16, // 4x4 projection * view matrix
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        };

        this.projectionViewBuffer = this.device.createBuffer(
            projectionViewBufferDescriptor
        );

        const lightBufferDescriptor: GPUBufferDescriptor = {
            label: "Light Buffer",
            size: Float32Array.BYTES_PER_ELEMENT * 4, // 3 for light position, 1 padding
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        };

        this.lightBuffer = this.device.createBuffer(
            lightBufferDescriptor
        );

        // Create bind groups and bindings
        this.globalBindGroupLayout = this.device.createBindGroupLayout({
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.VERTEX,
                    buffer: {type: "uniform"},
                },
                {
                    binding: 1,
                    visibility: GPUShaderStage.VERTEX,
                    buffer: {type: "read-only-storage"},
                }
            ],
        });

        this.globalBindGroup = this.device.createBindGroup({
            layout: this.globalBindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: {
                        buffer: this.projectionViewBuffer
                    },
                },
                {
                    binding: 1,
                    resource: {
                        buffer: this.lightBuffer,
                    }
                }
            ],
        });

        // load ply file
        const response = await fetch(`./assets/${this.plyFileName}`)
        const blob = await response.blob()
        const file = new File([blob], this.plyFileName)
        
        const parser = new PlyProcessor();
        await parser.parsePlyFilePopulateGaussianSplats(file);
    
        const preferredCanvasFormat: GPUTextureFormat = navigator.gpu.getPreferredCanvasFormat();
        this.points = new Points(this.device, parser.getGaussianSplats(), this.globalBindGroupLayout, preferredCanvasFormat);

        
        this.renderPassDescriptor = {
            colorAttachments: [{
                view: this.context.getCurrentTexture().createView(),
                loadOp: "clear",
                clearValue: { r: 1.0, g: 0.0, b: 0.0, a: 1.0 },
                storeOp: "store"
            }]
      };
    }

    private renderLoop = (): void => {
        const frameRenderStart: number = performance.now();

        // Update view matrix per frame
        const projectionViewStagingBuffer = this.device.createBuffer({
          size: 16 * Float32Array.BYTES_PER_ELEMENT,
          usage: GPUBufferUsage.COPY_SRC,
          mappedAtCreation: true
        });
        const projection: Mat4 = mat4.perspective(
            1.4,
            this.canvas.width / this.canvas.height,
            0.1,
            1000
        );
        const projectionViewMatrix: Mat4 = mat4.mul(projection, this.scene.camera.getViewMatrix());
        const map = new Float32Array(projectionViewStagingBuffer.getMappedRange());
        map.set(projectionViewMatrix);
        projectionViewStagingBuffer.unmap();
        // Update the view in the render pass descriptor each frame
        (this.renderPassDescriptor.colorAttachments as GPURenderPassColorAttachment[])[0].view = this.context.getCurrentTexture().createView();

        const commandEncoder = this.device.createCommandEncoder();
        commandEncoder.copyBufferToBuffer(projectionViewStagingBuffer, 0, this.projectionViewBuffer, 0, 16 * Float32Array.BYTES_PER_ELEMENT);
        const renderPass = commandEncoder.beginRenderPass(this.renderPassDescriptor);
        this.points.render(renderPass, this.globalBindGroup);
        renderPass.end();
  
        this.device.queue.submit([commandEncoder.finish()]);

        this.device.queue.onSubmittedWorkDone().then(
            () => {
                projectionViewStagingBuffer.destroy();

                const frameRenderEnd: number = performance.now();
                const performanceLabel = document.getElementById("render-time") as HTMLElement;
                if (performanceLabel) {
                    performanceLabel.innerText = (frameRenderEnd - frameRenderStart).toFixed(2);
                }
            }
        );

        requestAnimationFrame(this.renderLoop);
    };
}