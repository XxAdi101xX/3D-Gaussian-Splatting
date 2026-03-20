import { vec3, vec4, type Vec3, type Vec4 } from "wgpu-matrix";

// TODO does this need to be packed better for 16 byte alignment
export interface GaussianSplat {
    position: Vec3;
    rotation: Vec4; // Quaternion
    scale: Vec3;
    color: Vec3;
    opacity: number;
}