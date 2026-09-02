// =============================================================================
// Decode a QR image back to its payload, using Apple's Vision framework.
//
// WHY THIS EXISTS. `scripts/make-qr.js` has claimed since it was written that
// its output is "verified by decoding it back with macOS Vision
// (scripts/verify-qr.sh)". That script did not exist. The claim was true in
// spirit — someone checked once, by hand — but nothing re-checked it, and a QR
// is the one artefact whose failure is both total and invisible: it looks
// exactly like a QR code, and it does not scan. In front of people, on a
// laminated card, with no error anywhere.
//
// Vision is the right decoder here specifically BECAUSE it is not the encoder.
// Round-tripping through the same library proves the library is
// self-consistent, not that a phone can read the card. Vision is what the
// customer's iPhone camera actually uses.
//
// Usage: swift scripts/qr/decode-qr.swift <image.png>
//   stdout: the decoded payload, one per line (empty if none found)
//   exit 0 = at least one symbol decoded, 1 = nothing decodable
// =============================================================================

import Foundation
import Vision
import CoreImage

let args = CommandLine.arguments
guard args.count > 1 else {
    FileHandle.standardError.write("usage: decode-qr.swift <image>\n".data(using: .utf8)!)
    exit(2)
}

let url = URL(fileURLWithPath: args[1])
guard let ciImage = CIImage(contentsOf: url) else {
    FileHandle.standardError.write("could not read image: \(args[1])\n".data(using: .utf8)!)
    exit(2)
}

let request = VNDetectBarcodesRequest()
request.symbologies = [.qr]

let handler = VNImageRequestHandler(ciImage: ciImage, options: [:])
do {
    try handler.perform([request])
} catch {
    FileHandle.standardError.write("vision failed: \(error)\n".data(using: .utf8)!)
    exit(2)
}

let results = (request.results ?? []).compactMap { $0.payloadStringValue }
for payload in results {
    print(payload)
}
exit(results.isEmpty ? 1 : 0)
