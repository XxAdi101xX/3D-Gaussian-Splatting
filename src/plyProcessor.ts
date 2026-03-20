import { vec3, vec4, type Vec3, type Vec4 } from "wgpu-matrix";
import type { GaussianSplat } from "./gaussianSplat";

export class PlyProcessor {
    /* Variables */
    private static readonly PLY_KEYWORDS = {
        MAGIC:          'ply',
        FORMAT:         'format',
        ELEMENT_VERTEX: 'element',
        PROPERTY:       'property',
        COMMENT:        'comment',
        END_HEADER:     'end_header\n',
    } as const;

    private static readonly PLY_TYPES: Readonly<Record<string, {
        size: number;
        read: (dataView: DataView, offset: number, littleEndian: boolean) => number;
    }>> = {
        float:   { size: 4, read: (dv, o, le) => dv.getFloat32(o, le) },
        float32: { size: 4, read: (dv, o, le) => dv.getFloat32(o, le) },
        float64: { size: 8, read: (dv, o, le) => dv.getFloat64(o, le) },
        double:  { size: 8, read: (dv, o, le) => dv.getFloat64(o, le) },
        int8:    { size: 1, read: (dv, o)     => dv.getInt8(o) }, // endian irrelevant for 1-byte types
        uint8:   { size: 1, read: (dv, o)     => dv.getUint8(o) }, // endian irrelevant for 1-byte types
        int16:   { size: 2, read: (dv, o, le) => dv.getInt16(o, le) },
        uint16:  { size: 2, read: (dv, o, le) => dv.getUint16(o, le) },
        int32:   { size: 4, read: (dv, o, le) => dv.getInt32(o, le) },
        uint32:  { size: 4, read: (dv, o, le) => dv.getUint32(o, le) },
    };

    private static readonly PLY_FORMAT = {
        BinaryLittleEndian: 'binary_little_endian',
        BinaryBigEndian:    'binary_big_endian',
        Ascii:              'ascii',
    } as const;

    /* The normalization constant for the degree-0, 0 order spheerical harmonic basis function
     * This is calculated as Y_0^0 = 1 / (2 * sqrt(π))
     * TODO: We only use Y_0 here so we renders view-independent color. We should support degree-3 sphereical harmonics
     * similar to the original 3DGS implementation. This would make things more complicated since we can
     * no longer bake color at parse time, and would require a GPU efficient solution based on viewing angle
     */
    private static readonly SH_C0 = 0.28209479177387814;

    private header: string[] = [];
    private format: string = "";
    private splatCount: number = 0;
    private properties: { name: string; type: string }[] = [];
    private headerLength: number = 0;
    private gaussianSplats: GaussianSplat[] = [];

    /* Methods */
    static getTypeSize(type: string): number {
        return PlyProcessor.PLY_TYPES[type]?.size 
            ?? (() => { throw new Error(`Unknown type: ${type}`); })();
    }

    static readBinaryValue(dataView: DataView, offset: number, type: string, littleEndian: boolean): number {
        return PlyProcessor.PLY_TYPES[type]?.read(dataView, offset, littleEndian) 
            ?? (() => { throw new Error(`Unsupported binary type: ${type}`); })();
    }

    getGaussianSplats(): GaussianSplat[] {
        return this.gaussianSplats;
    }

    async parsePlyFilePopulateGaussianSplats(file: File) {
        const buffer = await file.arrayBuffer();
        const bytes = new Uint8Array(buffer);

        // Search raw bytes for the 'end_header\n'
        const endHeaderBytes = new TextEncoder().encode(PlyProcessor.PLY_KEYWORDS.END_HEADER);

        let headerEndByteIndex = -1;

        outerLoop: for (let i = 0; i <= bytes.length - endHeaderBytes.length; ++i) {
            for (let j = 0; j < endHeaderBytes.length; ++j) {
                if (bytes[i+j] !== endHeaderBytes[j]) {
                    continue outerLoop;
                }
            }

            headerEndByteIndex = i;
            break;
        }

        if (headerEndByteIndex === -1) {
            throw new Error("Invalid PLY file: Cannot find end of header");
        }

        this.headerLength = headerEndByteIndex +  endHeaderBytes.length;

        // Decode the header portion of the file
        const decoder = new TextDecoder();
        const headerText = decoder.decode(bytes.subarray(0, headerEndByteIndex));
        const headerLines: string[] = headerText.split("\n").map(line => line.trim());
        
        let headerLineIndex = 0;
        if (headerLines[headerLineIndex] !== PlyProcessor.PLY_KEYWORDS.MAGIC) {
            throw new Error(`Invalid PLY file: Missing ${PlyProcessor.PLY_KEYWORDS.MAGIC} header`);
        }

        headerLineIndex++;

        while (headerLineIndex < headerLines.length) {
            const line = headerLines[headerLineIndex];
            this.header.push(line);

            if (line.startsWith(PlyProcessor.PLY_KEYWORDS.FORMAT)) {
                this.format = line.split(' ')[1];
            } else if (line.startsWith(PlyProcessor.PLY_KEYWORDS.ELEMENT_VERTEX)) {
                this.splatCount = parseInt(line.split(' ')[2]);
            } else if (line.startsWith(PlyProcessor.PLY_KEYWORDS.PROPERTY)) {
                const parts = line.split(' ');
                this.properties.push({ name: parts[2], type: parts[1] });
            }

            headerLineIndex++;
        }

        // Parse splats
        if (this.format === PlyProcessor.PLY_FORMAT.BinaryLittleEndian || this.format === PlyProcessor.PLY_FORMAT.BinaryBigEndian) {
            const littleEndian = this.format === PlyProcessor.PLY_FORMAT.BinaryLittleEndian;
            this.gaussianSplats = this.parseSplatsFromBinary(buffer, littleEndian);
        } else if (this.format === PlyProcessor.PLY_FORMAT.Ascii) {
            throw new Error(`Unsupported PLY format: ${this.format}`);
        } else {
            throw new Error(`Unknown PLY format: ${this.format}`);
        }
    }

    private parseSplatsFromBinary(buffer: ArrayBuffer, littleEndian: boolean) {
        const dataView = new DataView(buffer);
        const splats: GaussianSplat[] = new Array(this.splatCount);

        // Pre-compute property byte offsets once, outside the loop
        const propOffsets: number[] = [];
        let stride = 0;
        for (const prop of this.properties) {
            propOffsets.push(stride);
            stride += PlyProcessor.getTypeSize(prop.type);
        }

        // Build a lookup map for property index by name
        const propIndex = new Map(this.properties.map((p, i) => [p.name, i]));
        const get = (base: number, name: string) => {
            const i = propIndex.get(name)!;
            return PlyProcessor.readBinaryValue(dataView, base + propOffsets[i], this.properties[i].type, littleEndian);
        };

        let base = this.headerLength;
        for (let v = 0; v < this.splatCount; v++, base += stride) {
            splats[v] = {
                position: vec3.create(
                    get(base, 'x'),
                    get(base, 'y'),
                    get(base, 'z')
                ),
                rotation: vec4.create(
                    get(base, 'rot_0'),
                    get(base, 'rot_1'),
                    get(base, 'rot_2'),
                    get(base, 'rot_3')
                ),
                scale: vec3.create(
                    Math.exp(get(base, 'scale_0')),
                    Math.exp(get(base, 'scale_1')),
                    Math.exp(get(base, 'scale_2'))
                ),
                color: vec3.create(
                    0.5 + PlyProcessor.SH_C0 * get(base, 'f_dc_0'),
                    0.5 + PlyProcessor.SH_C0 * get(base, 'f_dc_1'),
                    0.5 + PlyProcessor.SH_C0 * get(base, 'f_dc_2')
                ),
                opacity:  1.0 / (1.0 + Math.exp(-get(base, 'opacity')))
            };
        }

        return splats;
    }
}
