@group(0) @binding(0)
var<uniform> uView: mat4x4<f32>;

@group(0) @binding(1)
var<uniform> uProjection: mat4x4<f32>;

@group(0) @binding(2)
var<storage, read> uLights: array<vec4<f32>>;

@group(0) @binding(3)
var<uniform> uScreenSize: vec4<f32>;

@group(1) @binding(0)
var<storage, read> inCentroids: array<vec3<f32>>;

@group(1) @binding(1)
var<storage, read> inBasis: array<vec4<f32>>;

@group(1) @binding(2)
var<storage, read> inColors: array<vec4<f32>>;

struct VertexInput {
    @location(0) quadPos: vec2<f32>,
    @location(1) instanceId: u32,
};

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) localCoord: vec2<f32>,
    @location(1) color: vec4<f32>,
};

fn viewport_to_ndc_scale(screenSize: vec2<f32>) -> vec2<f32> {
    return vec2<f32>(2.0 / screenSize.x, 2.0 / screenSize.y);
}

fn gaussian_alpha(coord: vec2<f32>, sigma: f32) -> f32 {
    let r2 = dot(coord, coord);
    let sigma2 = sigma * sigma;
    let norm = 1.0 / (sigma * sqrt(2.0 * 3.14));
    return norm * exp(-0.5 * r2 / sigma2);
}

@vertex
fn vs_main(in: VertexInput) -> VertexOutput {
    var out: VertexOutput;

    let centroid = inCentroids[in.instanceId];
    let basis = inBasis[in.instanceId];
    let color = inColors[in.instanceId];

    let clipCenter = uProjection * uView * vec4<f32>(centroid, 1.0);
    let ndcCenter = clipCenter.xyz / clipCenter.w;

    let basisScale = viewport_to_ndc_scale(uScreenSize.xy);
    let basisOffset =
        in.quadPos.x * basis.xy +
        in.quadPos.y * basis.zw;
    let ndcOffset = basisOffset * basisScale;

    out.localCoord = in.quadPos;
    out.color = color;
    out.position = vec4<f32>(
        (ndcCenter.xy + ndcOffset) * clipCenter.w,
        ndcCenter.z * clipCenter.w,
        clipCenter.w
    );

    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    let scaledCoord = in.localCoord * 2.0;
    let falloff = -dot(scaledCoord, scaledCoord);

    if (falloff < -4.0) {
        discard;
    }

    let alpha = gaussian_alpha(in.localCoord, 0.25);
    return vec4<f32>(in.color.rgb, in.color.a * alpha);
}