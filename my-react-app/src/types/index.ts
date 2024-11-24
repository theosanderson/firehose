import { DynamicTexture, Mesh } from '@babylonjs/core';

export interface TextureObject {
    texture: DynamicTexture;
    lines: number;
}

export interface TextureUpdateResult {
    textureObj: TextureObject;
    lineCount: number;
}

export interface MessageObject {
    mesh: Mesh;
    textureObj: TextureObject;
    speed: number;
    special: boolean;
    arbitraryOrder: number;
    createdAt?: number;
}

export interface Settings {
    discardFraction: number;
    baseSpeed: number;
    audioMultiplier: number;
    specialFrequency: number;
    audioEnabled: boolean;
}
