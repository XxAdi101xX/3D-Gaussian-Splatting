import { vec3, mat4, type Vec3, type Mat4 } from "wgpu-matrix"

export class Camera {
    position: Vec3
    euler: Vec3
    readonly forward: Vec3
    readonly right: Vec3
    readonly up: Vec3

    constructor(position: Vec3, verticalRotation: number, horizontalRotation: number) {
        this.position = position;
        this.euler = vec3.create(0.0, verticalRotation, horizontalRotation)
        this.forward = vec3.create();
        this.right = vec3.create();
        this.up = vec3.create();

        this.update();
    }

    update(): void {
        const yaw = this.degreesToRadians(this.euler[2]);
        const pitch = this.degreesToRadians(this.euler[1]);

        // Forward vector from Euler angles
        this.forward[0] = Math.cos(yaw) * Math.cos(pitch);
        this.forward[1] = Math.sin(yaw) * Math.cos(pitch);
        this.forward[2] = Math.sin(pitch);

        // Orthogonal basis vectors
        vec3.cross(this.forward, vec3.create(0.0, 0.0, 1.0), this.right);
        vec3.cross(this.right, this.forward, this.up);
    }

    pan(dx: number, dy: number, dz: number): void {
        // Moving front/back
        vec3.addScaled(this.position, this.forward, dx, this.position);

        // Moving right/left
        vec3.addScaled(this.position, this.right, dy, this.position);

        // Moving up/down
        vec3.addScaled(this.position, this.up, dz, this.position);
    }

    /**
     * Computes the camera matrix which positions an object aiming down positive Z. toward the target.
     * Note: this is NOT the inverse of lookAt as lookAt looks at negative Z, whereas this looks at positive Z.
     * @returns The camera's matrix, which can be used to position objects in the scene relative to the camera's orientation and position.
     */
    getCameraMatrix(): Mat4 {
        const target = vec3.add(this.position, this.forward);
        // lookAt provides the view matrix.
        return mat4.aim(this.position, target, this.up);
    }

    /**
     * Computes the view matrix which transforms world coordinates into the camera's view space.
     * Note: this is NOT the inverse of the camera matrix, which looks at positive Z, whereas this looks at negative Z.
     * @returns The view matrix, which can be used to transform world coordinates into the camera's view space for rendering.
     */
    getViewMatrix(): Mat4 {
        const target = vec3.add(this.position, this.forward);
        // lookAt provides the view matrix.
        return mat4.lookAt(this.position, target, this.up);
    }

    private degreesToRadians(degrees: number): number {
        return degrees * Math.PI / 180.0;
    }
}