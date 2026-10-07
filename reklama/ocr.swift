// Prebere besedilo s posnetka zaslona (Apple Vision) in izpiše JSON: [{t, x, y, w, h}] v pikslih.
import AppKit
import Vision

let path = CommandLine.arguments[1]
guard let img = NSImage(contentsOfFile: path),
      let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else { print("[]"); exit(0) }
let W = Double(cg.width), H = Double(cg.height)
let req = VNRecognizeTextRequest()
req.recognitionLevel = .accurate
req.usesLanguageCorrection = false
req.recognitionLanguages = ["hr-HR", "en-US"]
try? VNImageRequestHandler(cgImage: cg).perform([req])
var out: [[String: Any]] = []
for o in req.results ?? [] {
    guard let c = o.topCandidates(1).first else { continue }
    let b = o.boundingBox
    out.append(["t": c.string, "x": b.minX * W, "y": (1 - b.maxY) * H, "w": b.width * W, "h": b.height * H])
}
let d = try! JSONSerialization.data(withJSONObject: out)
print(String(data: d, encoding: .utf8)!)
