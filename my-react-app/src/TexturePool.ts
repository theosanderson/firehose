import { Scene, DynamicTexture } from '@babylonjs/core';

interface TextureObject {
    texture: DynamicTexture;
    lines: number;
}

export class TexturePool {
    private scene: Scene;
    private pools: Map<number, TextureObject[]>;
    private inUse: Set<TextureObject>;
    private width: number;
    private lineHeight: number;
    private readonly MAX_LINES = 10;
    private readonly MIN_LINES = 1;

    constructor(
        scene: Scene, 
        lineHeight: number,
        width: number = 700,
        initialPoolSize: number = 1
    ) {
        this.scene = scene;
        this.lineHeight = lineHeight;
        this.width = width;
        this.pools = new Map();
        this.inUse = new Set();
        this.initPools(initialPoolSize);
    }

    private initPools(initialPoolSize: number): void {
        // Initialize pools for line counts 1-10
        for (let lines = this.MIN_LINES; lines <= this.MAX_LINES; lines++) {
            this.pools.set(lines, []);
            this.createTexturesForPool(lines, initialPoolSize);
        }
    }

    private createTexturesForPool(lines: number, count: number): void {
        const pool = this.pools.get(lines) || [];
        
        for (let i = 0; i < count; i++) {
            const texture = new DynamicTexture(
                `texture-${lines}lines-${i}`,
                { 
                    width: this.width, 
                    height: this.lineHeight * lines
                },
                this.scene,
                true
            );
            pool.push({ texture, lines });
        }
        
        this.pools.set(lines, pool);
    }

    public acquire(lines: number): TextureObject {
        // Validate input
        if (lines < this.MIN_LINES || lines > this.MAX_LINES) {
            throw new Error(`Number of lines must be between ${this.MIN_LINES} and ${this.MAX_LINES}, got ${lines}`);
        }

        const pool = this.pools.get(lines)!;

        // Find an available texture
        const textureObj = pool.find(obj => !this.inUse.has(obj));
        if (textureObj) {
            this.inUse.add(textureObj);
            textureObj.texture.clear();
            return textureObj;
        }

        // Create new texture if none available
        const texture = new DynamicTexture(
            `texture-${lines}lines-${pool.length}`,
            { 
                width: this.width, 
                height: this.lineHeight * lines
            },
            this.scene,
            true
        );
        
        const newObj = { texture, lines };
        pool.push(newObj);
        this.inUse.add(newObj);
        return newObj;
    }

    public release(textureObj: TextureObject): void {
        if (textureObj) {
            this.inUse.delete(textureObj);
        }
    }

    public getPoolSize(lines: number): number {
        if (lines < this.MIN_LINES || lines > this.MAX_LINES) return 0;
        return this.pools.get(lines)?.length || 0;
    }

    public getActiveTextures(lines: number): number {
        if (lines < this.MIN_LINES || lines > this.MAX_LINES) return 0;
        return Array.from(this.inUse).filter(obj => obj.lines === lines).length;
    }

    public cleanup(): void {
        this.pools.forEach(pool => {
            pool.forEach(obj => {
                if (!this.inUse.has(obj)) {
                    obj.texture.dispose();
                }
            });
        });
        
        // Reset pools but keep active textures
        const activeTextures = Array.from(this.inUse);
        this.pools = new Map();
        activeTextures.forEach(obj => {
            if (!this.pools.has(obj.lines)) {
                this.pools.set(obj.lines, []);
            }
            this.pools.get(obj.lines)!.push(obj);
        });
    }

    public getTotalActiveTextures(): number {
        return this.inUse.size;
    }

    public getTotalPoolSize(): number {
        let total = 0;
        this.pools.forEach(pool => {
            total += pool.length;
        });
        return total;
    }
}