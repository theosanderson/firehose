import {
    Engine,
    Scene,
    Vector3,
    Color3,
    Color4,
    UniversalCamera,
    StandardMaterial,
    MeshBuilder,
    Material,
    DynamicTexture
} from '@babylonjs/core';
import { TexturePool } from './TexturePool';
import { MessageObject, TextureUpdateResult } from './types';
import './styles.css';

const fontSize = 32;
const lineHeight = fontSize * 1.1;

class TextWrapper {
    private canvas: HTMLCanvasElement;
    private context: CanvasRenderingContext2D;

    constructor() {
        this.canvas = document.createElement('canvas');
        this.context = this.canvas.getContext('2d')!;
        this.context.font = `bold ${fontSize}px sans-serif`;
    }

    wrapText(text: string, maxWidth: number): string[] {
        const words = text.split(' ');
        const lines: string[] = [];
        let currentLine = words[0];

        for (let i = 1; i < words.length; i++) {
            const word = words[i];
            const width = this.context.measureText(currentLine + " " + word).width;
            if (width < maxWidth) {
                currentLine += " " + word;
            } else {
                lines.push(currentLine);
                currentLine = word;
            }
        }
        lines.push(currentLine);
        return lines;
    }
}

class BlueSkyViz {
    private canvas: HTMLCanvasElement;
    private engine: Engine;
    private scene: Scene;
    private camera: UniversalCamera;
    private texturePool: TexturePool;
    private messageObjects: MessageObject[] = [];
    private lastFrameTime: number = Date.now();
    private cameraRotation: number = 0;
    private camDir: number = 1;
    private readonly tunnelLength: number = 40;
    private textWrapper: TextWrapper;

    constructor() {
        this.canvas = document.getElementById('renderCanvas') as HTMLCanvasElement;
        this.engine = new Engine(this.canvas, true);
        this.scene = new Scene(this.engine);
        this.textWrapper = new TextWrapper();
        this.setupScene();
         this.camera = new UniversalCamera("camera", new Vector3(0, 0, 0), this.scene);
        this.setupCamera();
        this.texturePool = new TexturePool(this.scene, lineHeight);
        this.connectWebSocket();
        this.startRenderLoop();
        this.handleResize();
       
    }

    private setupScene(): void {
        this.scene.clearColor = new Color4(0, 0, 0, 1);
        this.scene.fogMode = Scene.FOGMODE_LINEAR;
        this.scene.fogColor = new Color3(0, 0, 0);
        this.scene.fogStart = 35;
        this.scene.fogEnd = 40;

        // Add custom render ordering
        this.scene.setRenderingOrder(0, null, null, (a, b) => {
            const meshA = a.getMesh();
            const meshB = b.getMesh();
            if (meshA && meshB) {
                return (meshA as any).renderOrder - (meshB as any).renderOrder;
            }
            return 0;
        });
    }

    private setupCamera(): void {
       
        this.camera.rotation.y = Math.PI;
        this.camera.rotation.x = 0.15;
        this.camera.fov = 1.85;
        this.camera.position.z = 8;
        this.camera.position.y = 1;
        this.camera.maxZ = 50;
    }

    private connectWebSocket(): void {
        const ws = new WebSocket('wss://bsky-relay.c.theo.io/subscribe?wantedCollections=app.bsky.feed.post');
        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.commit?.record?.text) {
                this.createMessage(data.commit.record.text);
            }
        };
    }

    private updateTextTexture(textureObj: any, lines: string[], specialColor: boolean): TextureUpdateResult {
        const texture = textureObj.texture;
        const context = texture.getContext();
        context.clearRect(0, 0, texture.getSize().width, texture.getSize().height);
        
        context.font = `bold ${fontSize}px sans-serif`;
        context.textAlign = 'center';
        context.textBaseline = 'middle';

        const totalHeight = lines.length * lineHeight;
        const startY = (texture.getSize().height - totalHeight) / 2;

        let r = Math.floor(Math.random() * 200 + 55);
        let g = Math.floor(Math.random() * 200 + 55);
        let b = Math.floor(Math.random() * 200 + 55);

        if (specialColor) {
            r = Math.floor(Math.random() * 100 + 155);
            g = Math.floor(Math.random() * 100 + 155);
            b = Math.floor(Math.random() * 100 + 155);
        }

        lines.forEach((line, index) => {
            const y = startY + (index * lineHeight) + lineHeight/2;
            
            context.shadowColor = 'rgba(0, 0, 0, 0.8)';
            context.shadowBlur = 15;
            context.shadowOffsetX = 0;
            context.shadowOffsetY = 0;
            
            context.strokeStyle = 'rgba(0, 0, 0, 0.9)';
            context.lineWidth = 6;
            context.strokeText(line, texture.getSize().width/2, y);

            context.fillStyle = `rgba(${r}, ${g}, ${b}, 0.9)`;
            context.fillText(line, texture.getSize().width/2, y);
        });
        
        texture.update(true);
        return { textureObj, lineCount: lines.length };
    }

    private createMessage(text: string): void {
        let wall = Math.floor(Math.random() * 4.04);
        const discardFrac = parseFloat(new URLSearchParams(window.location.search).get('discardFrac') || '0');

        if (wall !== -1 && discardFrac && Math.random() < discardFrac) {
            return;
        }

        if ( wall > 3) {
            wall = -1;
        }

        const loadingMessage = document.getElementById('temporary-loading-message');
        if (loadingMessage) {
            loadingMessage.style.display = 'none';
        }

        // Wrap text before acquiring texture
        let lines = this.textWrapper.wrapText(text, 650);
        if (lines.length > 10) {
            lines = lines.slice(0, 10);
        }
        
        const textureObj = this.texturePool.acquire(lines.length);
        const { lineCount } = this.updateTextTexture(textureObj, lines, wall === -1);
        
        const height =  lineCount * 0.75;
        const plane = MeshBuilder.CreatePlane("message", {
            width: 7,
            height
        }, this.scene);

        const material = new StandardMaterial("messageMat", this.scene);
        
        material.diffuseTexture = textureObj.texture;
        material.specularColor = new Color3(0, 0, 0);
        material.emissiveColor = new Color3(1, 1, 1);
        material.backFaceCulling = false;
        material.diffuseTexture.hasAlpha = true;
        material.useAlphaFromDiffuseTexture = true;
        material.transparencyMode = Material.MATERIAL_ALPHABLEND;
        material.separateCullingPass = true;
        
        plane.material = material;
        plane.position.z = -this.tunnelLength;

        (plane as any).renderOrder = 0;

        if (wall === -1) {
            const { x, y } = this.getCoordsNotInCenter();
            plane.position.x = x;
            plane.position.y = y;
            plane.rotation.y = Math.PI;
        } else {
            this.positionOnWall(plane, wall);
        }

        const arbitraryOrder = Math.round(Math.random() * 1000);
        (plane as any).renderOrder = wall === -1 ? arbitraryOrder + 10000 : arbitraryOrder;

        this.messageObjects.push({
            mesh: plane,
            textureObj,
            speed: wall===-1 ? 0.005+0.5 * (0.08 + Math.random() * 0.12) : 0.05 + Math.random() * 0.005,
            special: wall === -1,
            arbitraryOrder
        });
    }

    private getCoordsNotInCenter(): { x: number, y: number } {
        const centerExtent = 10;
        const centerExtentX = 7;
        const x = (Math.random()) * centerExtentX - centerExtentX/2;
        const y = (Math.random()) * centerExtent - centerExtent/2;
        
        if (Math.sqrt(x*x + y*y) < 2) {
            return this.getCoordsNotInCenter();
        }
        return { x, y };
    }

    private positionOnWall(plane: any, wall: number): void {
        const randomOffset = () => Math.random() * 2 - 1;
        
        switch(wall) {
            case 0:
                plane.position.x = 7.4 + randomOffset();
                plane.position.y = Math.random() * 12 - 6;
                plane.rotation.y = Math.PI/2;
                break;
            case 1:
                plane.position.x = -7.4 + randomOffset();
                plane.position.y = Math.random() * 12 - 6;
                plane.rotation.y = -Math.PI/2;
                break;
            case 2:
                plane.position.x = Math.random() * 12 - 6;
                plane.position.y = 7.4 + randomOffset();
                plane.rotation.x = -Math.PI/2;
                plane.rotation.y = Math.PI;
                break;
            case 3:
                plane.position.x = Math.random() * 12 - 6;
                plane.position.y = -7.4 + randomOffset();
                plane.rotation.x = Math.PI/2;
                plane.rotation.y = Math.PI;
                break;
        }
    }

    private startRenderLoop(): void {
        this.engine.runRenderLoop(() => {
            const currentTime = Date.now();
            const deltaTime = (currentTime - this.lastFrameTime) / 1000;
            this.lastFrameTime = currentTime;

            this.updateCamera(deltaTime);
            this.updateMessages(deltaTime);
            this.scene.render();
        });
    }

    private updateCamera(deltaTime: number): void {
        this.cameraRotation += deltaTime * 0.015 * this.camDir;
        if (this.cameraRotation > 0.18 * Math.PI/2) {
            this.camDir = -1;
        } else if (this.cameraRotation < 0.18 * -Math.PI/2) {
            this.camDir = 1;
        }
        this.camera.rotation.z = this.cameraRotation;
    }

    private updateMessages(deltaTime: number): void {
        for (let i = this.messageObjects.length - 1; i >= 0; i--) {
            const message = this.messageObjects[i];
            message.mesh.position.z += 100 * message.speed * deltaTime;
            message.mesh.renderOrder = message.arbitraryOrder;

            if (message.special) {
                (message.mesh as any).renderOrder = message.mesh.position.z + 10000;
            }

            if (message.mesh.position.z > 10) {
                message.mesh.dispose();
                this.texturePool.release(message.textureObj);
                this.messageObjects.splice(i, 1);
            }
        }
    }

    private handleResize(): void {
        window.addEventListener('resize', () => {
            this.engine.resize();
        });
    }
}

// Initialize the visualization when the DOM is loaded
window.addEventListener('DOMContentLoaded', () => {
    new BlueSkyViz();
});
