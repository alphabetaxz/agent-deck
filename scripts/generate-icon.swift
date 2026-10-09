import AppKit
import Foundation
// Vector artwork, rendered at every native macOS icon resolution.
let output = CommandLine.arguments[1]
let sizes = [(16, "icon_16x16.png"), (32, "icon_16x16@2x.png"), (32, "icon_32x32.png"), (64, "icon_32x32@2x.png"), (128, "icon_128x128.png"), (256, "icon_128x128@2x.png"), (256, "icon_256x256.png"), (512, "icon_256x256@2x.png"), (512, "icon_512x512.png"), (1024, "icon_512x512@2x.png")]
func color(_ r: CGFloat, _ g: CGFloat, _ b: CGFloat) -> NSColor { NSColor(srgbRed:r/255,green:g/255,blue:b/255,alpha:1) }
func diamond(_ x: CGFloat, _ y: CGFloat, _ radius: CGFloat) -> NSBezierPath {
    let p=NSBezierPath(); p.move(to:NSPoint(x:x,y:y+radius));p.line(to:NSPoint(x:x+radius,y:y));p.line(to:NSPoint(x:x,y:y-radius));p.line(to:NSPoint(x:x-radius,y:y));p.close();return p
}
for (size, name) in sizes {
    let bitmap=NSBitmapImageRep(bitmapDataPlanes:nil,pixelsWide:size,pixelsHigh:size,bitsPerSample:8,samplesPerPixel:4,hasAlpha:true,isPlanar:false,colorSpaceName:.deviceRGB,bytesPerRow:0,bitsPerPixel:0)!
    bitmap.size=NSSize(width:size,height:size)
    NSGraphicsContext.saveGraphicsState();NSGraphicsContext.current=NSGraphicsContext(bitmapImageRep:bitmap)
    let scale=CGFloat(size)/1024;let transform=AffineTransform(scale:scale);(transform as NSAffineTransform).concat()
    let tile=NSBezierPath(roundedRect:NSRect(x:64,y:64,width:896,height:896),xRadius:190,yRadius:190)
    let shadow=NSShadow();shadow.shadowColor=NSColor.black.withAlphaComponent(0.22);shadow.shadowBlurRadius=22;shadow.shadowOffset=NSSize(width:0,height:-10)
    NSGraphicsContext.saveGraphicsState();shadow.set();color(19,29,43).setFill();tile.fill();NSGraphicsContext.restoreGraphicsState()
    NSGradient(starting:color(39,59,74),ending:color(16,24,37))!.draw(in:tile,angle:270)
    color(73,94,106).withAlphaComponent(0.65).setStroke();tile.lineWidth=3;tile.stroke()
    color(168,234,209).setFill();diamond(512,548,280).fill()
    color(23,43,46).setFill();diamond(512,548,205).fill()
    color(168,234,209).setFill();diamond(512,548,127).fill()
    let baseline=NSBezierPath(roundedRect:NSRect(x:342,y:191,width:340,height:28),xRadius:14,yRadius:14);color(104,135,145).setFill();baseline.fill()
    let active=NSBezierPath(roundedRect:NSRect(x:342,y:191,width:220,height:28),xRadius:14,yRadius:14);color(168,234,209).setFill();active.fill()
    NSGraphicsContext.restoreGraphicsState()
    try bitmap.representation(using:.png,properties:[:])!.write(to:URL(fileURLWithPath:output).appendingPathComponent(name))
}
