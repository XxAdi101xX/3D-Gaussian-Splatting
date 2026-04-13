import type { GaussianSplat } from "./gaussianSplat";
import { vec4, type Mat4 } from "wgpu-matrix";
import splatShader from "./shaders/splat3d.wgsl?raw";

type SplatStorageBuffers = {
    positions: GPUBuffer;
    basis: GPUBuffer;
    colors: GPUBuffer;
};

type SplatVertexBuffers = {
    quad: GPUBuffer;
    ids: GPUBuffer;
};

type SplatVertexLayouts = {
    quad: GPUVertexBufferLayout;
    ids: GPUVertexBufferLayout;
};

const QUAD_VERTEX_COUNT = 4;
const FLOATS_PER_VEC4 = 4;

const ALPHA_BLEND_COLOR_STATE: Omit<GPUColorTargetState, "format"> = {
    blend: {
        alpha: {
            operation: "add",
            srcFactor: "one",
            dstFactor: "one-minus-src-alpha",
        },
        color: {
            operation: "add",
            srcFactor: "src-alpha",
            dstFactor: "one-minus-src-alpha",
        },
    },
};

function createMappedBuffer(
    device: GPUDevice,
    data: Float32Array | Uint32Array,
    usage: GPUBufferUsageFlags
): GPUBuffer {
    const buffer = device.createBuffer({
        size: data.byteLength,
        usage,
        mappedAtCreation: true,
    });

    const TypedArray = data instanceof Float32Array ? Float32Array : Uint32Array;
    new TypedArray(buffer.getMappedRange()).set(data);
    buffer.unmap();

    return buffer;
}

function createSplatBindGroupLayout(device: GPUDevice): GPUBindGroupLayout {
    return device.createBindGroupLayout({
        entries: [0, 1, 2].map((binding) => ({
            binding,
            visibility: GPUShaderStage.VERTEX,
            buffer: { type: "read-only-storage" as GPUBufferBindingType },
        })),
    });
}

function createQuadVertexData(): Float32Array {
    return new Float32Array([
        1, 1,
        -1, 1,
        1, -1,
        -1, -1,
    ]);
}

function createSplatIdData(count: number): Uint32Array {
    return Uint32Array.from({ length: count }, (_, i) => i);
}

function createQuadVertexLayout(): GPUVertexBufferLayout {
    return {
        arrayStride: 2 * Float32Array.BYTES_PER_ELEMENT,
        stepMode: "vertex",
        attributes: [
            {
                format: "float32x2",
                offset: 0,
                shaderLocation: 0,
            },
        ],
    };
}

function createSplatIdLayout(): GPUVertexBufferLayout {
    return {
        arrayStride: Uint32Array.BYTES_PER_ELEMENT,
        stepMode: "instance",
        attributes: [
            {
                format: "uint32",
                offset: 0,
                shaderLocation: 1,
            },
        ],
    };
}

function extractSplatPositions(splats: GaussianSplat[]): Float32Array {
    return new Float32Array(
        splats.flatMap((splat) => [
            splat.position[0],
            splat.position[1],
            splat.position[2],
            0.0,
        ])
    );
}

function extractSplatBasis(splats: GaussianSplat[]): Float32Array {
    return new Float32Array(
        splats.flatMap((splat) => [
            splat.basis[0],
            splat.basis[1],
            splat.basis[2],
            splat.basis[3],
        ])
    );
}

function extractSplatColors(splats: GaussianSplat[]): Float32Array {
    return new Float32Array(
        splats.flatMap((splat) => [
            splat.color[0],
            splat.color[1],
            splat.color[2],
            splat.opacity,
        ])
    );
}

export class GaussianSplats {
    private readonly pipeline: GPURenderPipeline;
    private readonly splatBindGroup: GPUBindGroup;
    private readonly storageBuffers: SplatStorageBuffers;
    private readonly vertexBuffers: SplatVertexBuffers;
    private readonly splats: GaussianSplat[];
    private readonly numSplats: number;

    constructor(
        device: GPUDevice,
        gaussianSplats: GaussianSplat[],
        globalBindGroupLayout: GPUBindGroupLayout,
        preferredCanvasFormat: GPUTextureFormat
    ) {
        this.splats = gaussianSplats;
        this.numSplats = gaussianSplats.length;

        const shaderModule = device.createShaderModule({ code: splatShader });
        const splatBindGroupLayout = createSplatBindGroupLayout(device);

        this.storageBuffers = this.createStorageBuffers(device, gaussianSplats);
        this.vertexBuffers = this.createVertexBuffers(device, gaussianSplats.length);
        this.splatBindGroup = this.createSplatBindGroup(device, splatBindGroupLayout);
        this.pipeline = this.createPipeline(
            device,
            shaderModule,
            globalBindGroupLayout,
            splatBindGroupLayout,
            preferredCanvasFormat
        );
    }

    public updateBasisBuffer(
        device: GPUDevice,
        projectionMatrix: Mat4,
        viewMatrix: Mat4,
        canvas: HTMLCanvasElement,
        commandEncoder: GPUCommandEncoder
    ): GPUBuffer {
        this.updateSplatBasis(projectionMatrix, viewMatrix, canvas);

        const basisData = extractSplatBasis(this.splats);
        const stagingBuffer = createMappedBuffer(
            device,
            basisData,
            GPUBufferUsage.COPY_SRC
        );

        commandEncoder.copyBufferToBuffer(
            stagingBuffer,
            0,
            this.storageBuffers.basis,
            0,
            basisData.byteLength
        );

        return stagingBuffer;
    }

    public updateSplatIndexBuffer(
        device: GPUDevice,
        projectionMatrix: Mat4,
        viewMatrix: Mat4,
        commandEncoder: GPUCommandEncoder
    ): GPUBuffer {
        const sortedIndices = this.computeSortedSplatIndices(
            projectionMatrix,
            viewMatrix
        );

        const indexUpdateBuffer = createMappedBuffer(
            device,
            sortedIndices,
            GPUBufferUsage.COPY_SRC
        );

        commandEncoder.copyBufferToBuffer(
            indexUpdateBuffer,
            0,
            this.vertexBuffers.ids,
            0,
            sortedIndices.byteLength
        );

        return indexUpdateBuffer;
    }

    public render(
        renderPass: GPURenderPassEncoder,
        globalBindGroup: GPUBindGroup
    ): void {
        renderPass.setPipeline(this.pipeline);
        renderPass.setBindGroup(0, globalBindGroup);
        renderPass.setBindGroup(1, this.splatBindGroup);
        renderPass.setVertexBuffer(0, this.vertexBuffers.quad);
        renderPass.setVertexBuffer(1, this.vertexBuffers.ids);

        for (let i = this.numSplats - 1; i >= 0; i--) {
            renderPass.draw(QUAD_VERTEX_COUNT, 1, 0, i);
        }
    }

    private createStorageBuffers(
        device: GPUDevice,
        splats: GaussianSplat[]
    ): SplatStorageBuffers {
        return {
            positions: createMappedBuffer(
                device,
                extractSplatPositions(splats),
                GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX
            ),
            basis: createMappedBuffer(
                device,
                extractSplatBasis(splats),
                GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
            ),
            colors: createMappedBuffer(
                device,
                extractSplatColors(splats),
                GPUBufferUsage.STORAGE
            ),
        };
    }

    private createVertexBuffers(
        device: GPUDevice,
        splatCount: number
    ): SplatVertexBuffers {
        return {
            quad: createMappedBuffer(
                device,
                createQuadVertexData(),
                GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
            ),
            ids: createMappedBuffer(
                device,
                createSplatIdData(splatCount),
                GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
            ),
        };
    }

    private createSplatBindGroup(
        device: GPUDevice,
        layout: GPUBindGroupLayout
    ): GPUBindGroup {
        return device.createBindGroup({
            layout,
            entries: [
                { binding: 0, resource: { buffer: this.storageBuffers.positions } },
                { binding: 1, resource: { buffer: this.storageBuffers.basis } },
                { binding: 2, resource: { buffer: this.storageBuffers.colors } },
            ],
        });
    }

    private createPipeline(
        device: GPUDevice,
        shaderModule: GPUShaderModule,
        globalBindGroupLayout: GPUBindGroupLayout,
        splatBindGroupLayout: GPUBindGroupLayout,
        preferredCanvasFormat: GPUTextureFormat
    ): GPURenderPipeline {
        const vertexLayouts: SplatVertexLayouts = {
            quad: createQuadVertexLayout(),
            ids: createSplatIdLayout(),
        };

        return device.createRenderPipeline({
            layout: device.createPipelineLayout({
                bindGroupLayouts: [globalBindGroupLayout, splatBindGroupLayout],
            }),
            vertex: {
                module: shaderModule,
                entryPoint: "vs_main",
                buffers: [vertexLayouts.quad, vertexLayouts.ids],
            },
            fragment: {
                module: shaderModule,
                entryPoint: "fs_main",
                targets: [
                    {
                        ...ALPHA_BLEND_COLOR_STATE,
                        format: preferredCanvasFormat,
                    },
                ],
            },
            primitive: {
                topology: "triangle-strip",
                frontFace: "ccw",
                cullMode: "none",
            },
        });
    }

    private updateSplatBasis(
        projectionMatrix: Mat4,
        viewMatrix: Mat4,
        canvas: HTMLCanvasElement
    ): void {
        for (const splat of this.splats) {
            splat.updateBasis(projectionMatrix, viewMatrix, canvas);
        }
    }

    private computeSortedSplatIndices(
        projectionMatrix: Mat4,
        viewMatrix: Mat4
    ): Uint32Array {
        const distances = this.splats.map((splat) => {
            const position = vec4.fromValues(
                splat.position[0],
                splat.position[1],
                splat.position[2],
                1.0
            );

            const viewPosition = vec4.transformMat4(position, viewMatrix);
            const projectedPosition = vec4.transformMat4(viewPosition, projectionMatrix);

            return projectedPosition[2] / projectedPosition[3];
        });

        const indices = Array.from({ length: distances.length }, (_, i) => i);
        indices.sort((a, b) => distances[a] - distances[b]);

        return new Uint32Array(indices);
    }
}