import { Scene } from "./scene";
import SplatRenderer from "./splatRenderer";

const bootstrap = async (): Promise<void> => {
    const canvas = document.getElementById("gfxCanvas") as HTMLCanvasElement | null;
    if (!canvas) {
        throw new Error("Canvas element 'gfxCanvas' not found");
    }

    canvas.width = canvas.height = 800;

    const scene = new Scene();
    const renderer = new SplatRenderer(canvas, scene);

    try {
        await renderer.start();
    } catch (e) {
        console.error("Failed to start renderer:", e);
        throw e;
    }
};

bootstrap();
