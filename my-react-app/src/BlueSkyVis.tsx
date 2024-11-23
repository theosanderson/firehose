import React, { useEffect, useRef, useState } from 'react';
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

interface BlueSkyVizProps {
    websocketUrl?: string;
    discardFraction?: number;
}

interface Settings {
    discardFraction: number;
    globalSpeed: number;
}

const BlueSkyViz: React.FC<BlueSkyVizProps> = ({ 
    websocketUrl = 'wss://bsky-relay.c.theo.io/subscribe?wantedCollections=app.bsky.feed.post',
    discardFraction = new URLSearchParams(window.location.search).get('discardFrac') ? 
        parseFloat(new URLSearchParams(window.location.search).get('discardFrac')!) : 0
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const engineRef = useRef<Engine | null>(null);
    const sceneRef = useRef<Scene | null>(null);
    const cameraRef = useRef<UniversalCamera | null>(null);
    const texturePoolRef = useRef<TexturePool | null>(null);
    const messageObjectsRef = useRef<MessageObject[]>([]);
    const lastFrameTimeRef = useRef<number>(Date.now());
    const cameraRotationRef = useRef<number>(0);
    const camDirRef = useRef<number>(1);
    const textWrapperRef = useRef<TextWrapper | null>(null);
    const animationFrameRef = useRef<number>();
    const connectingMessageRef = useRef<MessageObject | null>(null);

    const tunnelLength = 40;

    const setupScene = (scene: Scene) => {
        scene.clearColor = new Color4(0, 0, 0, 1);
        scene.fogMode = Scene.FOGMODE_LINEAR;
        scene.fogColor = new Color3(0, 0, 0);
        scene.fogStart = 35;
        scene.fogEnd = 40;

        scene.setRenderingOrder(0, null, null, (a, b) => {
            const meshA = a.getMesh();
            const meshB = b.getMesh();
            if (meshA && meshB) {
                return (meshA as any).renderOrder - (meshB as any).renderOrder;
            }
            return 0;
        });
    };

    const setupCamera = (scene: Scene) => {
        const camera = new UniversalCamera("camera", new Vector3(0, 0, 0), scene);
        camera.rotation.y = Math.PI;
        camera.rotation.x = 0.15;
        camera.fov = 1.85;
        camera.position.z = 8;
        camera.position.y = 1;
        camera.maxZ = 50;
        return camera;
    };

    const updateTextTexture = (textureObj: any, lines: string[], specialColor: boolean): TextureUpdateResult => {
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
    };

    const getCoordsNotInCenter = (): { x: number, y: number } => {
        const centerExtent = 10;
        const centerExtentX = 7;
        const x = (Math.random()) * centerExtentX - centerExtentX/2;
        const y = (Math.random()) * centerExtent - centerExtent/2;
        
        if (Math.sqrt(x*x + y*y) < 2) {
            return getCoordsNotInCenter();
        }
        return { x, y };
    };

    const positionOnWall = (plane: any, wall: number): void => {
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
    };

    const createMessage = (text: string) => {
        if (!sceneRef.current || !texturePoolRef.current || !textWrapperRef.current) return;

        let wall = Math.floor(Math.random() * 4.04);
        
        // Discard messages based on discardFraction, regardless of wall type
        if (wall!==-1 && discardFraction > 0 && Math.random() < discardFraction) {
            return;
        }

        if (wall > 3) {
            wall = -1;
        }

        let lines = textWrapperRef.current.wrapText(text, 650);
        if (lines.length > 10) {
            lines = lines.slice(0, 10);
        }
        
        const textureObj = texturePoolRef.current.acquire(lines.length);
        const { lineCount } = updateTextTexture(textureObj, lines, wall === -1);
        
        const height = lineCount * 0.75;
        const plane = MeshBuilder.CreatePlane("message", {
            width: 7,
            height
        }, sceneRef.current);

        const material = new StandardMaterial("messageMat", sceneRef.current);
        
        material.diffuseTexture = textureObj.texture;
        material.specularColor = new Color3(0, 0, 0);
        material.emissiveColor = new Color3(1, 1, 1);
        material.backFaceCulling = false;
        material.diffuseTexture.hasAlpha = true;
        material.useAlphaFromDiffuseTexture = true;
        material.transparencyMode = Material.MATERIAL_ALPHABLEND;
        material.separateCullingPass = true;
        
        plane.material = material;
        plane.position.z = -tunnelLength;

        (plane as any).renderOrder = 0;

        if (wall === -1) {
            const { x, y } = getCoordsNotInCenter();
            plane.position.x = x;
            plane.position.y = y;
            plane.rotation.y = Math.PI;
        } else {
            positionOnWall(plane, wall);
        }

        const arbitraryOrder = Math.round(Math.random() * 1000);
        (plane as any).renderOrder = wall === -1 ? arbitraryOrder + 10000 : arbitraryOrder;

        messageObjectsRef.current.push({
            mesh: plane,
            textureObj,
            speed: wall === -1 ? 0.005 + 0.5 * (0.08 + Math.random() * 0.12) : 0.05 + Math.random() * 0.005,
            special: wall === -1,
            arbitraryOrder
        });
    };

    const updateScene = () => {
        if (!sceneRef.current || !engineRef.current || !cameraRef.current) return;

        const currentTime = Date.now();
        const deltaTime = (currentTime - lastFrameTimeRef.current) / 1000;
        lastFrameTimeRef.current = currentTime;

        // Update camera
        cameraRotationRef.current += deltaTime * 0.015 * camDirRef.current;
        if (cameraRotationRef.current > 0.18 * Math.PI/2) {
            camDirRef.current = -1;
        } else if (cameraRotationRef.current < 0.18 * -Math.PI/2) {
            camDirRef.current = 1;
        }
        cameraRef.current.rotation.z = cameraRotationRef.current;

        // Update messages
        for (let i = messageObjectsRef.current.length - 1; i >= 0; i--) {
            const message = messageObjectsRef.current[i];
            message.mesh.position.z += 100 * message.speed * settings.globalSpeed * deltaTime;
            message.mesh.renderOrder = message.arbitraryOrder;

            if (message.special) {
                (message.mesh as any).renderOrder = message.mesh.position.z + 10000;
            }

            if (message.mesh.position.z > 10) {
                message.mesh.dispose();
                texturePoolRef.current?.release(message.textureObj);
                messageObjectsRef.current.splice(i, 1);
            }
        }

        // Handle connecting message fade out
        if (connectingMessageRef.current) {
            const elapsed = (Date.now() - connectingMessageRef.current.createdAt) / 1000;
            if (elapsed > 2) { // Start fading after 2 seconds
                const fadeProgress = Math.min((elapsed - 2) / 1, 1); // Fade over 1 second
                const material = connectingMessageRef.current.mesh.material as StandardMaterial;
                material.alpha = 1 - fadeProgress;
                
                if (fadeProgress === 1) {
                    connectingMessageRef.current.mesh.dispose();
                    texturePoolRef.current?.release(connectingMessageRef.current.textureObj);
                    connectingMessageRef.current = null;
                }
            }
        }

        sceneRef.current.render();
        animationFrameRef.current = requestAnimationFrame(updateScene);
    };

    useEffect(() => {
        if (!canvasRef.current) return;

        // Initialize engine and scene
        engineRef.current = new Engine(canvasRef.current, true);
        sceneRef.current = new Scene(engineRef.current);
        textWrapperRef.current = new TextWrapper();

        setupScene(sceneRef.current);
        cameraRef.current = setupCamera(sceneRef.current);
        texturePoolRef.current = new TexturePool(sceneRef.current, lineHeight);

        // Create connecting message after TexturePool is initialized
        if (textWrapperRef.current && sceneRef.current && texturePoolRef.current) {
            const connectingText = "< CONNECTING TO LIVE BLUESKY FIREHOSE >";
            const lines = textWrapperRef.current.wrapText(connectingText, 650);
            const textureObj = texturePoolRef.current.acquire(lines.length);
            const { lineCount } = updateTextTexture(textureObj, lines, true);
            
            const height = lineCount * 0.75;
            const plane = MeshBuilder.CreatePlane("connecting", {
                width: 7,
                height
            }, sceneRef.current);

            const material = new StandardMaterial("connectingMat", sceneRef.current);
            material.diffuseTexture = textureObj.texture;
            material.specularColor = new Color3(0, 0, 0);
            // Add a green retro glow effect
            material.emissiveColor = new Color3(0.2, 1, 0.2);
            material.backFaceCulling = false;
            material.diffuseTexture.hasAlpha = true;
            material.useAlphaFromDiffuseTexture = true;
            material.transparencyMode = Material.MATERIAL_ALPHABLEND;
            material.alphaMode = Engine.ALPHA_COMBINE;
            material.separateCullingPass = true;
            
            plane.material = material;
            plane.position = new Vector3(0, 0, 4);
            plane.rotation.y = Math.PI;
            (plane as any).renderOrder = 30000; // Ensure it renders on top of everything

            connectingMessageRef.current = {
                mesh: plane,
                textureObj,
                speed: 0,
                special: true,
                arbitraryOrder: 20000,
                createdAt: Date.now()
            };
        }

        // Connect WebSocket
        const ws = new WebSocket(websocketUrl);
        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.commit?.record?.text) {
                createMessage(data.commit.record.text);
            }
        };

        // Start render loop
        animationFrameRef.current = requestAnimationFrame(updateScene);

        // Handle resize
        const handleResize = () => {
            engineRef.current?.resize();
        };
        window.addEventListener('resize', handleResize);

        // Cleanup
        return () => {
            window.removeEventListener('resize', handleResize);
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
            ws.close();
            engineRef.current?.dispose();
            texturePoolRef.current?.cleanup();
        };
    }, [websocketUrl]);

    const [isMouseActive, setIsMouseActive] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [settings, setSettings] = useState<Settings>({
        discardFraction: discardFraction,
        globalSpeed: 1.0
    });
    const mouseTimeoutRef = useRef<NodeJS.Timeout>();

    const handleMouseMove = () => {
        setIsMouseActive(true);
        
        // Clear existing timeout
        if (mouseTimeoutRef.current) {
            clearTimeout(mouseTimeoutRef.current);
        }
        
        // Set new timeout to hide after 2 seconds
        mouseTimeoutRef.current = setTimeout(() => {
            setIsMouseActive(false);
        }, 2000);
    };

    useEffect(() => {
        // Cleanup timeout on unmount
        return () => {
            if (mouseTimeoutRef.current) {
                clearTimeout(mouseTimeoutRef.current);
            }
        };
    }, []);

    return (
        <div style={{ position: 'relative', width: '100%', height: '100%' }} onMouseMove={handleMouseMove}>
            <canvas 
                ref={canvasRef} 
                style={{ width: '100%', height: '100%' }}
                id="renderCanvas"
            />
            <div style={{ position: 'absolute', bottom: '20px', right: '20px', display: 'flex', gap: '10px' }}>
                <div
                    style={{
                        opacity: isMouseActive ? 1 : 0,
                        transition: 'opacity 0.3s ease-in-out',
                        cursor: 'pointer',
                        backgroundColor: 'rgba(0, 0, 0, 0.5)',
                        borderRadius: '50%',
                        padding: '8px',
                    }}
                    onClick={() => {
                        if (document.fullscreenElement) {
                            document.exitFullscreen();
                        } else {
                            document.documentElement.requestFullscreen();
                        }
                    }}
                >
                    <svg
                        width="24"
                        height="24"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="white"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    >
                        <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path>
                    </svg>
                </div>
                <div
                    style={{
                        opacity: isMouseActive ? 1 : 0,
                        transition: 'opacity 0.3s ease-in-out',
                        cursor: 'pointer',
                        backgroundColor: 'rgba(0, 0, 0, 0.5)',
                        borderRadius: '50%',
                        padding: '8px',
                    }}
                    onClick={() => setShowSettings(true)}
                >
                    <svg 
                        width="24" 
                        height="24" 
                        viewBox="0 0 24 24" 
                        fill="none" 
                        stroke="white" 
                        strokeWidth="2" 
                        strokeLinecap="round" 
                        strokeLinejoin="round"
                    >
                        <circle cx="12" cy="12" r="3"></circle>
                        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                    </svg>
                </div>
            </div>
            {showSettings && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: 'rgba(0, 0, 0, 0.5)',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    zIndex: 1000
                }}>
                    <div style={{
                        backgroundColor: '#1a1a1a',
                        padding: '20px',
                        borderRadius: '8px',
                        width: '300px'
                    }}>
                        <h2 style={{ color: 'white', marginTop: 0 }}>Settings</h2>
                        <div style={{ marginBottom: '15px' }}>
                            <label style={{ color: 'white', display: 'block', marginBottom: '5px' }}>
                                Discard Fraction (0-1):
                            </label>
                            <input
                                type="range"
                                min="0"
                                max="1"
                                step="0.1"
                                value={settings.discardFraction}
                                onChange={(e) => setSettings({
                                    ...settings,
                                    discardFraction: parseFloat(e.target.value)
                                })}
                                style={{ width: '100%' }}
                            />
                            <span style={{ color: 'white' }}>{settings.discardFraction.toFixed(1)}</span>
                        </div>
                        <div style={{ marginBottom: '15px' }}>
                            <label style={{ color: 'white', display: 'block', marginBottom: '5px' }}>
                                Global Speed (0.1-2):
                            </label>
                            <input
                                type="range"
                                min="0.1"
                                max="2"
                                step="0.1"
                                value={settings.globalSpeed}
                                onChange={(e) => setSettings({
                                    ...settings,
                                    globalSpeed: parseFloat(e.target.value)
                                })}
                                style={{ width: '100%' }}
                            />
                            <span style={{ color: 'white' }}>{settings.globalSpeed.toFixed(1)}x</span>
                        </div>
                        <button
                            onClick={() => setShowSettings(false)}
                            style={{
                                backgroundColor: '#333',
                                color: 'white',
                                border: 'none',
                                padding: '8px 16px',
                                borderRadius: '4px',
                                cursor: 'pointer'
                            }}
                        >
                            Close
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default BlueSkyViz;
