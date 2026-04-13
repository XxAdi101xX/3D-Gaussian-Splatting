import { quat, vec2, vec3, vec4, mat3, mat4, type Quat, type Vec3, type Vec4, type Mat3, type Mat4 } from "wgpu-matrix";

export class GaussianSplat {
    position: Vec3;
    rotation: Vec4;
    scale: Vec3;
    color: Vec3;
    opacity: number;
    covariance: Mat3;
    basis: Vec4;

    constructor(
        position: Vec3,
        rotation: Vec4,
        scale: Vec3,
        color: Vec3,
        opacity: number
    ) {
        this.position = position;
        this.rotation = rotation;
        this.scale = scale;
        this.color = color;
        this.opacity = opacity;

        const rotMat = mat3.create();
        const scaleMat = mat3.create();
        const T = mat3.create();
        const TTranspose = mat3.create();
        this.basis = vec4.create(1, -1, -1, -1);
        this.covariance = mat3.create();

        // rotation is stored as [w, x, y, z], but quat functions expect [x, y, z, w]
        const rotationQuat: Quat = quat.fromValues(this.rotation[1], this.rotation[2], this.rotation[3], this.rotation[0]);
        quat.normalize(rotationQuat, rotationQuat);

        mat3.fromQuat(rotationQuat, rotMat);
        mat3.scaling3D(this.scale, scaleMat);

        mat3.mul(rotMat, scaleMat, T);
        mat3.transpose(T, TTranspose);
        mat3.mul(T, TTranspose, this.covariance);
        this.basis = vec4.create(1, -1, 1, 1);
    }

    public updateBasis(
        projectionMatrix: Mat4,
        viewMatrix: Mat4,
        canvas: HTMLCanvasElement
    ) {
        const renderDimension = { x: canvas.clientWidth, y: canvas.clientHeight };
        const focal = {
            x: projectionMatrix[0] * renderDimension.x * 0.5,
            y: projectionMatrix[5] * renderDimension.y * 0.5,
        };

        const viewCenter = vec4.transformMat4(
            vec4.create(this.position[0], this.position[1], this.position[2], 1.0),
            viewMatrix
        );

        const s = 1.0 / (viewCenter[2] * viewCenter[2]);

        const jacobian = mat3.create(
            focal.x / viewCenter[2], 0, -(focal.x * viewCenter[0]) * s,
            0, focal.y / viewCenter[2], -(focal.y * viewCenter[1]) * s,
            0, 0, 0
        );

        const W = mat3.transpose(mat3.fromMat4(viewMatrix));
        const T = mat3.mul(W, jacobian);

        const newC = mat3.mul(
            mat3.transpose(T),
            mat3.mul(this.covariance, T)
        );

        // The basis vectors are the eigenvectors of the covariance matrix, scaled by the square root of the eigenvalues (which represent the variance along those directions).
        // Note that mat3 is actually padded to be 4x4 to comply with WebGPU standards, so we need to account for the 4th element in each column as garbage when indexing
        const cov2Dv = vec3.create(newC[0], newC[1], newC[5]);

        const a = cov2Dv[0];
        const b = cov2Dv[1];
        const d = cov2Dv[2];

        const D = a * d - b * b;
        const trace = a + d;
        const traceOver2 = trace / 2;
        const term2 = Math.sqrt(trace * trace / 4.0 - D);
        const eigen1 = traceOver2 + term2;
        const eigen2 = Math.max(traceOver2 - term2, 0);

        const maxSplatRadius = 1024;

        const eigenVector1 = vec2.normalize(vec2.fromValues(b, eigen1 - a));
        const eigenVector2 = vec2.fromValues(eigenVector1[1], -eigenVector1[0]);

        const basisVector1 = vec2.scale(
            eigenVector1,
            Math.min(Math.sqrt(eigen1) * 4, maxSplatRadius)
        );

        const basisVector2 = vec2.scale(
            eigenVector2,
            Math.min(Math.sqrt(eigen2) * 4, maxSplatRadius)
        );

        this.basis = vec4.create(
            basisVector1[0],
            basisVector1[1],
            basisVector2[0],
            basisVector2[1]
        );
    }
}