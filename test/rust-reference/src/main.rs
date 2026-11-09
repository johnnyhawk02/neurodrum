// Copies of app/src/engine.rs and app/src/presets.rs are pulled in by build-time path.
#[path = "../../../../neurodrum/app/src/presets.rs"]
mod presets;
#[path = "../../../../neurodrum/app/src/engine.rs"]
#[allow(dead_code)]
mod engine;

use std::io::Write;

fn main() {
    let out_dir = std::env::args().nth(1).unwrap_or_else(|| "out".into());
    std::fs::create_dir_all(&out_dir).unwrap();
    let sr = 48000.0;
    let frames = 48000 * 4; // four seconds per preset
    for (n, preset) in presets::FACTORY.iter().enumerate() {
        let mut e = engine::Engine::new(sr);
        e.params = engine::Params::from_factory(preset);
        for i in 0..engine::VOICES {
            let t = e.params.voices[i].threshold;
            e.set_threshold(i, t);
        }
        e.start();
        let mut all = Vec::with_capacity(frames * 2);
        let mut buf = vec![0f32; 128 * 2];
        while all.len() < frames * 2 {
            e.render(&mut buf, 2);
            all.extend_from_slice(&buf);
        }
        let mut f = std::fs::File::create(format!("{out_dir}/preset-{n:02}.f32")).unwrap();
        for s in &all {
            f.write_all(&s.to_le_bytes()).unwrap();
        }
    }
    println!("rendered {} presets", presets::FACTORY.len());
}
