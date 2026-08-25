import Foundation
import CoreImage
import AppKit

let args = CommandLine.arguments
guard args.count > 1, let img = NSImage(contentsOfFile: args[1]),
      let tiff = img.tiffRepresentation, let bmp = NSBitmapImageRep(data: tiff),
      let cg = bmp.cgImage else { print("LOAD_FAIL"); exit(2) }
let ci = CIImage(cgImage: cg)
let det = CIDetector(ofType: CIDetectorTypeQRCode, context: nil,
                     options: [CIDetectorAccuracy: CIDetectorAccuracyHigh])!
let found = det.features(in: ci).compactMap { ($0 as? CIQRCodeFeature)?.messageString }
if found.isEmpty { print("NO_QR_FOUND"); exit(1) }
found.forEach { print($0) }
