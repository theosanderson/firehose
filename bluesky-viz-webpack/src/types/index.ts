export interface MessageObject {
    mesh: any;
    textureObj: TextureObject;
    speed: number;
    special: boolean;
    arbitraryOrder: number;
}

export interface TextureObject {
    texture: any;
    lines: number;
}

export interface TextureUpdateResult {
    textureObj: TextureObject;
    lineCount: number;
}
