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
    ParticleSystem,
    Texture,
    PointLight,
    HemisphericLight,
    Mesh,
    CubeTexture,
    PBRMetallicRoughnessMaterial,
    TransformNode
} from '@babylonjs/core';
import { TexturePool } from './TexturePool';
import { MessageObject, TextureUpdateResult, Settings, SpaceshipState } from './types';

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

// Add styles to head
const styleSheet = document.createElement('style');
styleSheet.textContent = `
    .control-button {
        transition: opacity 0.3s ease-in-out;
        cursor: pointer;
        background-color: rgba(0, 0, 0, 0.5);
        border-radius: 50%;
        padding: 8px;
    }
    .control-button:hover {
        opacity: 1 !important;
    }
`;
document.head.appendChild(styleSheet);

const BlueSkyViz: React.FC<BlueSkyVizProps> = ({ 
    websocketUrl = 'wss://bsky-relay.c.theo.io/subscribe?wantedCollections=app.bsky.feed.post',
    discardFraction = new URLSearchParams(window.location.search).get('discardFrac') ? 
        parseFloat(new URLSearchParams(window.location.search).get('discardFrac')!) : 
        (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ? 0.5 : 0)
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

    const updateTextTexture = (textureObj: any, lines: string[], specialColor: boolean, useBoldFont: boolean = true): TextureUpdateResult => {
        const texture = textureObj.texture;
        const context = texture.getContext();
        context.clearRect(0, 0, texture.getSize().width, texture.getSize().height);
        
        context.font = `${useBoldFont ? 'bold ' : ''}${fontSize}px sans-serif`;
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
       
        let wall = Math.floor(Math.random() * (4 + 1* settingsRef.current.specialFrequency));
        
        // Discard messages based on discardFraction, regardless of wall type
        if (wall > 3) {
            wall = -1;
        }
        
        if (wall!==-1 && settingsRef.current.discardFraction > 0 && Math.random() < settingsRef.current.discardFraction) {
          
            return;
        }
     

        

        let lines = textWrapperRef.current.wrapText(text, 650);
        if (lines.length > 10) {
            lines = lines.slice(0, 10);
        }
        
        const textureObj = texturePoolRef.current.acquire(lines.length);
        const { lineCount } = updateTextTexture(textureObj, lines, wall === -1);
        
        const planeHeight = lineCount * 0.75;
        const planeWidth = 7;
        const plane = MeshBuilder.CreatePlane("message", {
            width: planeWidth,
            height: planeHeight
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

        (plane as any).renderOrder = 0; // Using type assertion for custom property

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
            arbitraryOrder,
            width: planeWidth,
            height: planeHeight
        });
    };

    const updateScene = () => {
        if (!sceneRef.current || !engineRef.current || !cameraRef.current) return;

        const currentTime = Date.now();
        const deltaTime = (currentTime - lastFrameTimeRef.current) / 1000;
        lastFrameTimeRef.current = currentTime;

        // Calculate audio multiplier
        let audioMultiplier = 1.0;
        if (settingsRef.current.audioEnabled && analyserRef.current && audioDataRef.current) {
            analyserRef.current.getByteFrequencyData(audioDataRef.current);
            // Get average of frequencies
            const sum = audioDataRef.current.reduce((a, b) => a + b, 0);
            const avg = sum / audioDataRef.current.length;
            // Map 0-255 to 0.1-3.0 for audio multiplier
            audioMultiplier = 0.1 + (avg / 255) * 2.9;
        }

        // Update camera
        cameraRotationRef.current += deltaTime * 0.015 * camDirRef.current;
        if (cameraRotationRef.current > 0.13 * Math.PI/2) {
            camDirRef.current = -1;
        } else if (cameraRotationRef.current < 0.13 * -Math.PI/2) {
            camDirRef.current = 1;
        }
        cameraRef.current.rotation.z = cameraRotationRef.current;

        // Update messages
        for (let i = messageObjectsRef.current.length - 1; i >= 0; i--) {
            const message = messageObjectsRef.current[i];
            message.mesh.position.z += 100 * message.speed * settingsRef.current.baseSpeed * audioMultiplier * deltaTime;
            (message.mesh as any).renderOrder = message.arbitraryOrder;

            if (message.special) {
                (message.mesh as any).renderOrder = message.mesh.position.z + 10000;
            }

            if (message.mesh.position.z > 10) {
                message.mesh.dispose();
                texturePoolRef.current?.release(message.textureObj);
                messageObjectsRef.current.splice(i, 1);
                if (message.special){
                  
                // Increment score and adjust game parameters
                scoreRef.current += 1;
                setScore(scoreRef.current);
                if (scoreRef.current > maxScoreRef.current) {
                    maxScoreRef.current = scoreRef.current;
                    setMaxScore(maxScoreRef.current);
                }
                
                if (scoreRef.current % 10 === 0) {
                    const newSpeed = Math.min(5.0, settingsRef.current.baseSpeed * 1.12);
                    const newSpecialFreq = Math.max(0,  1.12*(settingsRef.current.specialFrequency ) );
                    
                    setSettings(prev => ({
                        ...prev,
                        baseSpeed: newSpeed,
                        specialFrequency: newSpecialFreq
                    }));
                    
                    settingsRef.current.baseSpeed = newSpeed;
                    settingsRef.current.specialFrequency = newSpecialFreq;
                }
            }
        }
    }

        // Handle connecting message fade out
        if (connectingMessageRef.current) {
            const elapsed = (Date.now() - (connectingMessageRef.current.createdAt || Date.now())) / 1000;
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

        // Update spaceship position and check collisions
        if (settingsRef.current.spaceshipEnabled && spaceshipRef.current.mesh && !spaceshipRef.current.exploding) {
            const ship = spaceshipRef.current.mesh;
            
            const targetX = Math.max(-7, Math.min(7, spaceshipRef.current.targetX));
            const targetY = Math.max(-7, Math.min(7, spaceshipRef.current.targetY));
            
            // Smooth interpolation
            ship.position.x += (targetX - ship.position.x) * 0.1;
            ship.position.y += (targetY - ship.position.y) * 0.1;
            
            // Add slight rotation based on movement
            ship.rotation.z = (targetX - ship.position.x) * 0.2;
            ship.rotation.y = (targetY - ship.position.y) * 0.2;

            // Check for collisions with messages
            for (const message of messageObjectsRef.current) {
                // Account for message rotation when checking collisions
                const messageRotationY = message.mesh.rotation.y;
                const dx = ship.position.x - message.mesh.position.x;
                const dy = ship.position.y - message.mesh.position.y;
                const dz = ship.position.z - message.mesh.position.z;
                
                // Transform ship position relative to message orientation
                const rotatedDx = dx * Math.cos(-messageRotationY) - dz * Math.sin(-messageRotationY);
                const rotatedDz = dx * Math.sin(-messageRotationY) + dz * Math.cos(-messageRotationY);
                
                
                // Collision box sizes
                const messageHalfWidth = message.width / 2;
                const messageHalfHeight = message.height / 2;
                const messageDepth = 0.1; // Thickness of message plane
                
                if (Math.abs(rotatedDx) < messageHalfWidth &&
                    Math.abs(dy) < messageHalfHeight &&
                    Math.abs(rotatedDz) < messageDepth) {
                    
                    if (!spaceshipRef.current.exploding) {
                        // Trigger explosion
                        spaceshipRef.current.exploding = true;
                        
                        // Create main explosion particles
                        const particleSystem = new ParticleSystem("explosion", 2000, sceneRef.current!);
                        particleSystem.renderingGroupId = 1;
                        particleSystem.particleTexture = new Texture("https://www.babylonjs.com/assets/Flare.png", sceneRef.current);
                        particleSystem.emitter = ship;
                        particleSystem.minEmitBox = new Vector3(-0.5, -0.5, -0.5);
                        particleSystem.maxEmitBox = new Vector3(0.5, 0.5, 0.5);
                        particleSystem.color1 = new Color4(1, 0.5, 0, 1);
                        particleSystem.color2 = new Color4(1, 0.2, 0, 1);
                        particleSystem.colorDead = new Color4(0.2, 0, 0, 0);
                        particleSystem.minSize = 0.2;
                        particleSystem.maxSize = 0.8;
                        particleSystem.minLifeTime = 0.3;
                        particleSystem.maxLifeTime = 1.5;
                        particleSystem.emitRate = 2000;
                        particleSystem.blendMode = ParticleSystem.BLENDMODE_ONEONE;
                        particleSystem.gravity = new Vector3(0, -5, 0);
                        particleSystem.direction1 = new Vector3(-4, 8, -4);
                        particleSystem.direction2 = new Vector3(4, 8, 4);
                        particleSystem.minAngularSpeed = 0;
                        particleSystem.maxAngularSpeed = Math.PI * 2;
                        particleSystem.minEmitPower = 5;
                        particleSystem.maxEmitPower = 10;
                        particleSystem.updateSpeed = 0.02;

                        // Create spark particles
                        const sparkSystem = new ParticleSystem("sparks", 500, sceneRef.current!);
                        sparkSystem.renderingGroupId = 1;
                        sparkSystem.particleTexture = new Texture("https://www.babylonjs.com/assets/Flare.png", sceneRef.current);
                        sparkSystem.emitter = ship;
                        sparkSystem.minEmitBox = new Vector3(-0.2, -0.2, -0.2);
                        sparkSystem.maxEmitBox = new Vector3(0.2, 0.2, 0.2);
                        sparkSystem.color1 = new Color4(1, 0.9, 0.5, 1);
                        sparkSystem.color2 = new Color4(1, 0.8, 0, 1);
                        sparkSystem.colorDead = new Color4(1, 0.3, 0, 0);
                        sparkSystem.minSize = 0.05;
                        sparkSystem.maxSize = 0.2;
                        sparkSystem.minLifeTime = 1;
                        sparkSystem.maxLifeTime = 2;
                        sparkSystem.emitRate = 300;
                        sparkSystem.blendMode = ParticleSystem.BLENDMODE_ONEONE;
                        sparkSystem.gravity = new Vector3(0, -2, 0);
                        sparkSystem.direction1 = new Vector3(-8, 8, -8);
                        sparkSystem.direction2 = new Vector3(8, 8, 8);
                        sparkSystem.minAngularSpeed = Math.PI;
                        sparkSystem.maxAngularSpeed = Math.PI * 4;
                        sparkSystem.minEmitPower = 10;
                        sparkSystem.maxEmitPower = 20;
                        sparkSystem.updateSpeed = 0.01;


                        
                        // Hide ship and stop engine particles
                        spaceshipRef.current.allMeshes?.forEach((mesh: Mesh) => {
                            mesh.visibility = 0;
                        });
                        const engineParticles = sceneRef.current.getParticleSystemByID("engineParticles");
                        if (engineParticles) {
                            engineParticles.stop();
                        }
                        
                        // Start explosion particle systems
                        particleSystem.start();
                        sparkSystem.start();

                        // Cleanup all particle systems
                        setTimeout(() => {
                            particleSystem.dispose();
                            sparkSystem.dispose();
                        }, 2500);
                        
                        // Reset after explosion
                        setTimeout(() => {
                            if (spaceshipRef.current.mesh) {
                                spaceshipRef.current.allMeshes?.forEach((mesh: Mesh) => {
                                    mesh.visibility = 1;
                                });
                                spaceshipRef.current.exploding = false;
                                // Reset position
                                ship.position.x = 0;
                                ship.position.y = 0;
                                spaceshipRef.current.targetX = 0;
                                spaceshipRef.current.targetY = 0;
                                
                                // Reset score but keep max score
                                scoreRef.current = 0;
                                setScore(0);
                                // Update max score one final time in case we crashed right after getting a point
                                if (scoreRef.current > maxScoreRef.current) {
                                    maxScoreRef.current = scoreRef.current;
                                    setMaxScore(maxScoreRef.current);
                                }
                                const defaultSpeed = 1.0;
                                const defaultSpecialFreq = 0.04;
                                settingsRef.current.baseSpeed = defaultSpeed;
                                settingsRef.current.specialFrequency = defaultSpecialFreq;
                                setSettings(prev => ({
                                    ...prev,
                                    baseSpeed: defaultSpeed,
                                    specialFrequency: defaultSpecialFreq
                                }));
                                
                                // Restart engine particles
                                const engineParticles = sceneRef.current.getParticleSystemByID("engineParticles");
                                if (engineParticles) {
                                    engineParticles.start();
                                }
                            }
                        }, 2000);
                    }
                    
                    break;
                }
            }
        }

        // Update engine particles position if spaceship exists
        if (settingsRef.current.spaceshipEnabled && spaceshipRef.current.mesh && !spaceshipRef.current.exploding) {
            const engineParticles = sceneRef.current.getParticleSystemByID("engineParticles");
            if (engineParticles) {
                engineParticles.emitPosition = new Vector3(0, 0, 1.2);
            }
        }

        sceneRef.current.render();
        animationFrameRef.current = requestAnimationFrame(updateScene);
    };

    useEffect(() => {
        // setTimeout to enable spaceship
        setTimeout(() => {
            if (sceneRef.current) {
                createSpaceship(sceneRef.current);
            }
            settingsRef.current.spaceshipEnabled = true;
            setSettings({ ...settingsRef.current });

        }, 500);
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
            
            const lines = [
                " ",
                " "
            ]
            const textureObj = texturePoolRef.current.acquire(lines.length);
            
            // Override font just for connecting message
            const context = textureObj.texture.getContext();
            context.font = `${fontSize}px sans-serif`;  // Remove bold
            
            const { lineCount } = updateTextTexture(textureObj, lines, true, false);
            
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
                createdAt: Date.now(),
                width: 7,
                height: lineCount * 0.75
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

        // Create spaceship if enabled
        if (settings.spaceshipEnabled) {
            createSpaceship(sceneRef.current);
        }

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
    const [showMusic, setShowMusic] = useState(false);
    const [score, setScore] = useState(0);
    const [maxScore, setMaxScore] = useState(0);
    const scoreRef = useRef(0);
    const maxScoreRef = useRef(0);
    const [settings, setSettings] = useState<Settings>({
        discardFraction: discardFraction,
        baseSpeed: 1.0,
        audioMultiplier: 1.0,
        specialFrequency: 0.04,
        audioEnabled: false,
        spaceshipEnabled: false
    });
    const settingsRef = useRef<Settings>({
        discardFraction: discardFraction,
        baseSpeed: 1.0,
        audioMultiplier: 1.0,
        specialFrequency: 0.04,
        audioEnabled: false,
        spaceshipEnabled: false
    });
    const analyserRef = useRef<AnalyserNode | null>(null);
    const audioDataRef = useRef<Uint8Array | null>(null);
    const mouseTimeoutRef = useRef<NodeJS.Timeout>();
    const spaceshipRef = useRef<SpaceshipState>({
        mesh: null,
        targetX: 0,
        targetY: 0,
        exploding: false
    });

    const createSpaceship = (scene: Scene) => {
        if (spaceshipRef.current.mesh) return;
    
        // Load an environment texture for PBR materials
        const hdrTexture = CubeTexture.CreateFromPrefilteredData(
            "https://playground.babylonjs.com/textures/environment.dds",
            scene
        );
        scene.environmentTexture = hdrTexture;
        scene.createDefaultSkybox(hdrTexture, true, 1000);
    
        // Main body - cylindrical shape pointing towards -Z
        const body = MeshBuilder.CreateCylinder(
            "body",
            {
                height: 2, // Length along Z-axis
                diameter: 0.6, // Width along X-axis
                tessellation: 24,
            },
            scene
        );
        body.rotation.x = Math.PI / 2; // Align cylinder along Z-axis
        body.position.z = 0; // Center the body
    
        // Cockpit - at the front
        const cockpit = MeshBuilder.CreateSphere(
            "cockpit",
            {
                diameter: 0.4,
                segments: 16,
            },
            scene
        );
        cockpit.scaling = new Vector3(0.6, 0.6, 1);
        cockpit.position = new Vector3(0, 0, -1); // Positioned at the front along -Z
    
        // Nose cone - added at the very front
        const noseCone = MeshBuilder.CreateCylinder(
            "noseCone",
            {
                height: 0.5,
                diameterTop: 0,
                diameterBottom: 0.5,
                tessellation: 24,
            },
            scene
        );
        noseCone.rotation.x = -Math.PI / 2; // Align along Z-axis
        noseCone.position.z = -1.3; // Positioned at the very front
    
        // Create wings - swept back
        const createWing = (name: string, isUpper: boolean, isLeft: boolean) => {
            const wing = MeshBuilder.CreateBox(
                name,
                {
                    height: 0.05, // Thickness of the wing
                    width: 1.2, // Wing length along X-axis
                    depth: 0.4, // Wing width along Z-axis
                },
                scene
            );
    
            // Position the wing
            wing.position.x = isLeft ? 0.75 : -0.75;
            wing.position.y = isUpper ? 0.5 : -0.5;
            wing.position.z = 0.4; // Slightly towards the back
    
           
    
            // Rotate the wing to form an X shape
            const angle = (isUpper ? 1 : -1) * (isLeft ? 1 : -1) * (Math.PI / 6);
            wing.rotation.z = angle;
    
            return wing;
        };
    
        // Create four wings
        const upperLeftWing = createWing("upperLeftWing", true, true);
        const upperRightWing = createWing("upperRightWing", true, false);
        const lowerLeftWing = createWing("lowerLeftWing", false, true);
        const lowerRightWing = createWing("lowerRightWing", false, false);
    
        // PBR Materials
        const bodyMaterial = new PBRMetallicRoughnessMaterial("bodyMat", scene);
        bodyMaterial.baseColor = new Color3(0.5, 0.5, 0.5);
        bodyMaterial.metallic = 0.0; // Non-metallic
        bodyMaterial.roughness = 1; // Slightly rough surface
    
        const cockpitMaterial = new PBRMetallicRoughnessMaterial("cockpitMat", scene);
        cockpitMaterial.baseColor = new Color3(0.2, 0.4, 0.6);
        cockpitMaterial.metallic = 0.0;
        cockpitMaterial.roughness = 0.1; // Smooth surface
        cockpitMaterial.alpha = 0.9; // Slight transparency
    
        const noseConeMaterial = new PBRMetallicRoughnessMaterial("noseConeMat", scene);
        noseConeMaterial.baseColor = new Color3(0.5, 0.5, 0.5);
        noseConeMaterial.metallic = 0.0;
        noseConeMaterial.roughness = 0.7;
    
    
        // Apply materials
        body.material = bodyMaterial;
        cockpit.material = cockpitMaterial;
        noseCone.material = noseConeMaterial;
        [upperLeftWing, upperRightWing, lowerLeftWing, lowerRightWing].forEach((wing) => {
            wing.material = bodyMaterial;
        });
    
        // Create container
        const container = new TransformNode("container", scene);
    
        // Parent all meshes to container
        const allMeshes = [
            body,
            cockpit,
            noseCone,
            upperLeftWing,
            upperRightWing,
            lowerLeftWing,
            lowerRightWing,
        ];
        allMeshes.forEach((mesh) => {
            mesh.parent = container;
        });
    
        // Add engine light
        const engineLight = new PointLight("engineLight", new Vector3(0, 0, 1.5), scene);
        engineLight.diffuse = new Color3(1, 0.5, 0);
        engineLight.intensity = 0.7;
        engineLight.range = 3;
        engineLight.parent = container; // Parent to the container
        engineLight.position = new Vector3(0, 0, 1.2); // Position at the engine location
    
        // Ambient light (increased intensity)
        const ambientLight = new HemisphericLight(
            "ambientLight",
            new Vector3(0, 1, 0),
            scene
        );
        ambientLight.intensity = 0.01;
        ambientLight.groundColor = new Color3(0.2, 0.2, 0.4);
    
        // Position the ship
        container.position = new Vector3(0, 0, 5);

        // Create engine particle system
        const engineParticles = new ParticleSystem("engineParticles", 2000, scene);
        engineParticles.particleTexture = new Texture("https://www.babylonjs.com/assets/Flare.png", scene);
        engineParticles.renderingGroupId = 1; // Ensure renders on top
        engineParticles.emitter = container; // Use container as emitter
        
        engineParticles.minEmitBox = new Vector3(-0.2, -0.2, 1);
        engineParticles.maxEmitBox = new Vector3(0.2, 0.2, 1);
        engineParticles.color1 = new Color4(1, 0.5, 0, 1);
        engineParticles.color2 = new Color4(1, 0.2, 0, 1);
        engineParticles.colorDead = new Color4(0, 0, 0, 0);
        engineParticles.minSize = 0.01;
        engineParticles.maxSize = 0.2;
        engineParticles.minLifeTime = 0.01;
        engineParticles.maxLifeTime = 0.1;
        engineParticles.emitRate = 15000;
        engineParticles.blendMode = ParticleSystem.BLENDMODE_ONEONE;
        engineParticles.gravity = new Vector3(0, 0, 2);
        engineParticles.direction1 = new Vector3(0, 0, 100);
        engineParticles.direction2 = new Vector3(0, 0, 100);
        engineParticles.minEmitPower = 2;
        engineParticles.maxEmitPower = 4;
        engineParticles.updateSpeed = 0.01;
        engineParticles.parent = container;
        engineParticles.start();
    
        spaceshipRef.current.mesh = container as unknown as Mesh;
        spaceshipRef.current.allMeshes = allMeshes;
    };
    
    

    const [touchStartX, setTouchStartX] = useState<number | null>(null);
    const [touchStartY, setTouchStartY] = useState<number | null>(null);
    const [shipStartX, setShipStartX] = useState<number>(0);
    const [shipStartY, setShipStartY] = useState<number>(0);

    const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
        setIsMouseActive(true);
        if (mouseTimeoutRef.current) {
            clearTimeout(mouseTimeoutRef.current);
        }
        mouseTimeoutRef.current = setTimeout(() => {
            setIsMouseActive(false);
        }, 2000);

        if (settings.spaceshipEnabled) {
            setTouchStartX(e.touches[0].clientX);
            setTouchStartY(e.touches[0].clientY);
            setShipStartX(spaceshipRef.current.targetX);
            setShipStartY(spaceshipRef.current.targetY);
        }
    };

    const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
        if (settings.spaceshipEnabled && touchStartX !== null && touchStartY !== null && canvasRef.current) {
            const rect = canvasRef.current.getBoundingClientRect();
            const deltaX = (e.touches[0].clientX - touchStartX) / rect.width * 28; // Amplify movement
            const deltaY = (e.touches[0].clientY - touchStartY) / rect.height * 28;
            
            // Update target position relative to start position
            spaceshipRef.current.targetX = Math.max(-7, Math.min(7, shipStartX - deltaX));
            spaceshipRef.current.targetY = Math.max(-7, Math.min(7, shipStartY - deltaY));
        }
    };

    const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
        setIsMouseActive(true);
        if (mouseTimeoutRef.current) {
            clearTimeout(mouseTimeoutRef.current);
        }
        mouseTimeoutRef.current = setTimeout(() => {
            setIsMouseActive(false);
        }, 2000);

        // Update spaceship target position for mouse movement (absolute positioning)
        if (settings.spaceshipEnabled && canvasRef.current) {
            const rect = canvasRef.current.getBoundingClientRect();
            const x = -(((e.clientX - rect.left) / rect.width) * 14 - 7);
            const y = -(((e.clientY - rect.top) / rect.height) * 14 - 7);
            
            spaceshipRef.current.targetX = x;
            spaceshipRef.current.targetY = y;
        }
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
        <div 
            style={{ position: 'relative', width: '100%', height: '100%' }} 
            onMouseMove={handleMouseMove}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
        >
            <canvas 
                ref={canvasRef} 
                style={{ width: '100%', height: '100%' }}
                id="renderCanvas"
            />
            <div style={{
                position: 'absolute',
                top: '20px',
                right: '20px',
                color: 'white',
                fontSize: '18px',
                fontFamily: 'sans-serif',
                padding: '10px',
                backgroundColor: 'rgba(0, 0, 0, 0.5)', 
                borderRadius: '8px',
                opacity: 0.7,
                fontVariant: '',
                letterSpacing: '0.5px',
                textAlign: 'right'
            }}>
                <span style={{fontSize: '18px'}}>SCORE: {score}</span>
                {maxScore > score && (
                    <>
                        <br />
                        <span style={{fontSize: '18px'}}>TOP SCORE: {maxScore}</span>
                    </>
                )}
            </div>
            <div style={{ position: 'absolute', bottom: '20px', right: '20px', display: 'flex', gap: '10px' }}>
                <div
                    className="control-button"
                    style={{
                        opacity: isMouseActive ? .7 : 0,
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
                    className="control-button"
                    style={{
                        opacity: isMouseActive ? .7 : 0,
                    }}
                    onClick={() => {
                        const win = window.open('https://bsky.app/profile/theo.io/post/3lbvc33xtgc2t', '_blank');
                        win?.focus();
                    }}
                >
                    <svg 
                        xmlns="http://www.w3.org/2000/svg" 
                        width="24" 
                        height="24" 
                        viewBox="0 0 48 48" 
                        className="inline-block"
                    >
                        <g fill="none" stroke="white" strokeLinecap="round" strokeLinejoin="round" strokeWidth="4">
                            <path fill="white" d="M5 12c3.664-4.294 14.081 6.82 19 13c4.92-6.18 15.337-17.294 19-13c.679.65 1.443 2.877-1 6c-.678.976-1.814 3.706-1 8c0 1.139-1.115 2.952-6 1c2.375 1.627 6.85 6.096 4 10c-2.714 3.416-9.035 7.457-13-2l-2-4l-2 4c-3.964 9.457-10.286 5.416-13 2c-2.85-3.904 1.626-8.373 4-10c-4.885 1.952-6 .139-6-1c.814-4.294-.321-7.024-1-8c-2.442-3.123-1.678-5.35-1-6"></path>
                            <path d="M24.032 23C23.534 17.864 28.913 7 33 7"></path>
                            <path d="M23.968 23C24.466 17.864 19.087 7 15 7"></path>
                        </g>
                    </svg>
                </div>
            </div>
            {true && (
                <div style={{
                   
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: 'rgba(0, 0, 0, 0.5)',
                    display: showSettings ? 'flex' : 'none',
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
                                Proportion of posts to show:
                            </label>
                            <input
                                type="range"
                                min="0"
                                max="1"
                                step="0.1"
                                value={1 - settings.discardFraction}
                                onChange={(e) => {
                                    const newValue = 1 - parseFloat(e.target.value);
                                    setSettings(prev => ({
                                        ...prev,
                                        discardFraction: newValue
                                    }));
                                    settingsRef.current.discardFraction = newValue;
                                }}
                                style={{ width: '100%' }}
                            />
                            <span style={{ color: 'white' }}>{(100 * (1 - settings.discardFraction)).toFixed(0)}%</span>
                        </div>
                        <div style={{ marginBottom: '15px' }}>
                            <label style={{ color: 'white', display: 'block', marginBottom: '5px' }}>
                                Speed:
                            </label>
                            <input
                                type="range"
                                min="0.1"
                                max="5"
                                step="0.1"
                                value={settings.baseSpeed}
                                onChange={(e) => {
                                    const newValue = parseFloat(e.target.value);
                                    setSettings(prev => ({
                                        ...prev,
                                        baseSpeed: newValue
                                    }));
                                    settingsRef.current.baseSpeed = newValue;
                                }}
                                style={{ width: '100%' }}
                            />
                            <span style={{ color: 'white' }}>{settings.baseSpeed.toFixed(1)}x</span>
                        </div>
                        <div style={{ marginBottom: '15px' }}>
                            <div 
                                onClick={() => {
                                    const newValue = !settings.audioEnabled;
                                    setSettings(prev => ({
                                        ...prev,
                                        audioEnabled: newValue
                                    }));
                                    settingsRef.current.audioEnabled = newValue;
                                    
                                    if (newValue && !analyserRef.current) {
                                        navigator.mediaDevices.getUserMedia({ audio: true, video: false })
                                            .then(stream => {
                                                const audioContext = new AudioContext();
                                                const source = audioContext.createMediaStreamSource(stream);
                                                const webAudioAnalyser = audioContext.createAnalyser();
                                                webAudioAnalyser.fftSize = 32;
                                                webAudioAnalyser.smoothingTimeConstant = 0.4;
                                                source.connect(webAudioAnalyser);
                                                
                                                analyserRef.current = webAudioAnalyser;
                                                audioDataRef.current = new Uint8Array(webAudioAnalyser.frequencyBinCount);
                                            })
                                            .catch(err => {
                                                console.error("Error accessing microphone:", err);
                                                setSettings(prev => ({
                                                    ...prev,
                                                    audioEnabled: false
                                                }));
                                                settingsRef.current.audioEnabled = false;
                                            });
                                    }
                                }}
                                style={{ cursor: 'pointer' }}
                            >
                                <label style={{ color: 'white', display: 'block', marginBottom: '5px' }}>
                                    React to microphone input:
                                </label>
                                <input
                                    type="checkbox"
                                    checked={settings.audioEnabled}
                                    onChange={() => {}} // Handle click on parent div instead
                                style={{ marginRight: '8px' }}
                            />
                            <span style={{ color: 'white' }}>Audio Reactive</span>
                            </div>
                        </div>
                        <div style={{ marginBottom: '15px' }}>
                            <label style={{ color: 'white', display: 'block', marginBottom: '5px' }}>
                                Focal post intensity:
                            </label>
                            <input
                                type="range"
                                min="0"
                                max="0.2"
                                step="0.01"
                                value={settings.specialFrequency}
                                onChange={(e) => {
                                    const newValue = parseFloat(e.target.value);
                                    setSettings(prev => ({
                                        ...prev,
                                        specialFrequency: newValue
                                    }));
                                    settingsRef.current.specialFrequency = newValue;
                                }}
                                style={{ width: '100%' }}
                            />
                            <span style={{ color: 'white' }}>{(settings.specialFrequency * 100).toFixed(1)}%</span>
                        </div>
                        <div style={{ marginBottom: '15px' }}>
                            <div 
                                onClick={() => {
                                    const newValue = !settingsRef.current.spaceshipEnabled;
                                    settingsRef.current.spaceshipEnabled = newValue;
                                    setSettings(prev => ({
                                        ...prev,
                                        spaceshipEnabled: newValue
                                    }));
                                    
                                    if (newValue && sceneRef.current) {
                                        createSpaceship(sceneRef.current);
                                    } else if (!newValue && spaceshipRef.current.mesh) {
                                        spaceshipRef.current.mesh.dispose();
                                        spaceshipRef.current.mesh = null;
                                    }
                                }}
                                style={{ cursor: 'pointer' }}
                            >
                                <label style={{ color: 'white', display: 'block', marginBottom: '5px' }}>
                                    Enable spaceship:
                                </label>
                                <input
                                    type="checkbox"
                                    checked={settingsRef.current.spaceshipEnabled}
                                    onChange={() => {}} // Handle click on parent div instead
                                    style={{ marginRight: '8px' }}
                                />
                                <span style={{ color: 'white' }}>Show spaceship</span>
                            </div>
                        </div>
                        {
                            showMusic?
                            <iframe width="100%" height="100" scrolling="no" frameBorder="no" allow="autoplay" src="https://w.soundcloud.com/player/?url=https%3A//api.soundcloud.com/tracks/961687216&color=%23ff5500&auto_play=false&hide_related=false&show_comments=true&show_user=true&show_reposts=false&show_teaser=true&visual=true"
                            style={{borderRadius:"10px",
                                marginBottom: "15px",


                            }}

                            ></iframe>
                            :
                            <button onClick={() => setShowMusic(true)} style={{
                               // style as link
                             display:"block",
                             textDecoration: "underline",
                                color: "#aaa",
                                backgroundColor: "transparent",
                                marginBottom: "15px",
                            }}>
                                Backing audio (hit "Listen in browser")
                                </button>
                        }

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
