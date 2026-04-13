import type { GaussianSplat } from "./gaussianSplat";
import point_shader from "./shaders/point.wgsl?raw";

function createVertexBuffer(device: GPUDevice, data: Float32Array): GPUBuffer {
    const buffer = device.createBuffer({
        size: data.byteLength,
        usage: GPUBufferUsage.VERTEX,
        mappedAtCreation: true,
    });
    new Float32Array(buffer.getMappedRange()).set(data);
    buffer.unmap();
    return buffer;
}

function makeBufferLayout(
    shaderLocation: number,
    format: GPUVertexFormat,
    componentCount: number
): GPUVertexBufferLayout {
    return {
        attributes: [{ shaderLocation, format, offset: 0 }],
        arrayStride: Float32Array.BYTES_PER_ELEMENT * componentCount,
        stepMode: "vertex",
    };
}

export class Points {
    private pipeline: GPURenderPipeline;
    private positionBuffer: GPUBuffer;
    private colorBuffer: GPUBuffer;
    private opacityBuffer: GPUBuffer;
    private numVertices: number;

    constructor(
        device: GPUDevice,
        gaussianSplats: GaussianSplat[],
        globalBindGroupLayout: GPUBindGroupLayout,
        preferredCanvasFormat: GPUTextureFormat
    ) {
        this.numVertices = gaussianSplats.length;

        const positions = new Float32Array(gaussianSplats.flatMap(splat => [splat.position[0], splat.position[1], splat.position[2]]));      
        const colors = new Float32Array(gaussianSplats.flatMap(_ => [0, 1, 0])); // defaulted to green
        const opacities = new Float32Array(gaussianSplats.length).fill(1); // default to opaque

        this.positionBuffer = createVertexBuffer(device, positions);
        this.colorBuffer = createVertexBuffer(device, colors);
        this.opacityBuffer = createVertexBuffer(device, opacities);

        const shaderModule = device.createShaderModule({ code: point_shader });

        this.pipeline = device.createRenderPipeline({
            layout: device.createPipelineLayout({
                bindGroupLayouts: [globalBindGroupLayout],
            }),
            vertex: {
                module: shaderModule,
                entryPoint: "vs_main",
                buffers: [
                    makeBufferLayout(0, "float32x3", 3), // position
                    makeBufferLayout(1, "float32x3", 3), // color
                    makeBufferLayout(2, "float32", 1), // opacity
                ],
            },
            fragment: {
                module: shaderModule,
                entryPoint: "fs_main",
                targets: [{ format: preferredCanvasFormat }],
            },
            primitive: {
                topology: "point-list",
                frontFace: "ccw",
                cullMode: "none",
            },
        });
    }

    public render(
        renderPass: GPURenderPassEncoder,
        viewParamsBindGroup: GPUBindGroup
    ): void {
        renderPass.setPipeline(this.pipeline);
        renderPass.setBindGroup(0, viewParamsBindGroup);
        renderPass.setVertexBuffer(0, this.positionBuffer);
        renderPass.setVertexBuffer(1, this.colorBuffer);
        renderPass.setVertexBuffer(2, this.opacityBuffer);
        renderPass.draw(this.numVertices, 1);
    }
}