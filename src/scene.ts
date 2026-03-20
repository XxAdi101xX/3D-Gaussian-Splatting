import { vec3, type Vec3 } from "wgpu-matrix";
import { Camera } from "./camera";

export class Light {
    position: Vec3;
    padding = 0.0;
    constructor(position: Vec3) {
        this.position = vec3.clone(position);
    }
}

export class Scene {
    camera: Camera;
    lights: Light[] = [];
    private isDragging = false;

    constructor() {
        this.camera = new Camera(vec3.create(-1, 0, 0), 0, 0);
        this.lights.push(new Light(vec3.create(11, -15, -12)));

        this.setupInput();
    }

    private setupInput() {
        const canvas = document.getElementById("gfxCanvas") as HTMLCanvasElement;
        if (!canvas) {
            console.warn("Canvas not found");
            return;
        }

        canvas.tabIndex = 1;
        canvas.focus();

        canvas.addEventListener("mousedown", (e) => {
            if (e.button !== 0) return;  // Left click only
            this.isDragging = true;
            canvas.requestPointerLock();
            e.preventDefault();
        });

        document.addEventListener("mouseup", (e) => {
            if (e.button === 0) {  // Left button release
                this.isDragging = false;
                document.exitPointerLock();
            }
        });

        document.addEventListener("mousemove", (e) => {
            if (!this.isDragging) return;

            const sensitivity = 0.3;
            const deltaX = e.movementX * sensitivity;
            const deltaY = e.movementY * sensitivity;

            this.camera.euler[2] += deltaX;
            this.camera.euler[1] += deltaY;
            this.camera.euler[1] = Math.max(-85, Math.min(85, this.camera.euler[1]));
            this.camera.update();
        });

        document.addEventListener("keydown", (e) => {
            const speed = 0.05;
            switch (e.code) {
                case "KeyW": this.camera.pan(speed, 0, 0); break;
                case "KeyS": this.camera.pan(-speed, 0, 0); break;
                case "KeyA": this.camera.pan(0, -speed, 0); break;
                case "KeyD": this.camera.pan(0, speed, 0); break;
                case "KeyQ": this.camera.pan(0, 0, -speed); break;
                case "KeyE": this.camera.pan(0, 0, speed); break;
            }
        });

        // Light controls
        const lightInputs = ["lightX", "lightY", "lightZ"] as const;
        lightInputs.forEach((id, i) => {
            const input = document.getElementById(id) as HTMLInputElement;
            if (input) {
                input.value = this.lights[0].position[i].toFixed(1);
                input.addEventListener("input", () => {
                    this.lights[0].position[i] = parseFloat(input.value) || 0;
                });
            }
        });
    }
}
