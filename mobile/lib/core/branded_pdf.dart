import 'package:flutter/services.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:share_plus/share_plus.dart';

/// Generates locally; patient data never leaves the device for conversion.
Future<Uint8List> buildBrandedPdf(
    {required String title,
    required String reference,
    required String body}) async {
  final font = pw.Font.ttf(await rootBundle.load('assets/fonts/Inter.ttf'));
  final hindi =
      pw.Font.ttf(await rootBundle.load('assets/fonts/NotoSansDevanagari.ttf'));
  final logo = pw.MemoryImage(
      (await rootBundle.load('assets/branding/app_icon.png'))
          .buffer
          .asUint8List());
  final primary = PdfColor.fromHex('#AD5D3B');
  final muted = PdfColor.fromHex('#6F6A64');
  final border = PdfColor.fromHex('#E9E5E0');
  final document = pw.Document(title: title, author: 'BookADoctors');
  final content = <pw.Widget>[];
  for (final raw in body.split('\n')) {
    final line = raw.trim();
    if (line.isEmpty ||
        RegExp(r'^[=\-]+$').hasMatch(line) ||
        line.startsWith('BOOKADOCTORS -')) {
      continue;
    }
    if (RegExp(r'^[A-Z &]+:$').hasMatch(line)) {
      content.add(pw.Container(
        margin: const pw.EdgeInsets.only(top: 14, bottom: 5),
        padding: const pw.EdgeInsets.symmetric(horizontal: 8, vertical: 6),
        width: double.infinity,
        color: PdfColor.fromHex('#F5E9E3'),
        child: pw.Text(line.substring(0, line.length - 1),
            style: pw.TextStyle(color: primary, fontSize: 10)),
      ));
      continue;
    }
    final colon = line.indexOf(':');
    final label = colon > 0 && colon < 80 ? line.substring(0, colon) : '';
    final value = label.isEmpty ? line : line.substring(colon + 1).trim();
    // Preserve all text while bounding each row so long notes can paginate safely.
    for (var offset = 0; offset < value.length || offset == 0; offset += 400) {
      final end = (offset + 400).clamp(0, value.length);
      final part = value.substring(offset, end);
      content.add(pw.Container(
        padding: const pw.EdgeInsets.symmetric(vertical: 6),
        decoration: pw.BoxDecoration(
            border:
                pw.Border(bottom: pw.BorderSide(color: border, width: 0.4))),
        child: label.isEmpty
            ? pw.Text(part, style: const pw.TextStyle(fontSize: 9))
            : pw.Row(
                crossAxisAlignment: pw.CrossAxisAlignment.start,
                children: [
                    pw.SizedBox(
                        width: 125,
                        child: pw.Text(
                            offset == 0 ? label : '$label (continued)',
                            style: pw.TextStyle(color: muted, fontSize: 9))),
                    pw.SizedBox(width: 12),
                    pw.Expanded(
                        child: pw.Text(part,
                            style: const pw.TextStyle(fontSize: 10))),
                  ]),
      ));
      if (value.isEmpty) break;
    }
  }
  document.addPage(pw.MultiPage(
    pageFormat: PdfPageFormat.a4,
    margin: const pw.EdgeInsets.all(36),
    maxPages: 100,
    theme: pw.ThemeData.withFont(base: font, bold: font, fontFallback: [hindi]),
    header: (_) => pw.Container(
      margin: const pw.EdgeInsets.only(bottom: 16),
      padding: const pw.EdgeInsets.only(bottom: 12),
      decoration: pw.BoxDecoration(
          border: pw.Border(bottom: pw.BorderSide(color: primary, width: 2))),
      child:
          pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
        pw.Row(children: [
          pw.Image(logo, width: 36, height: 36),
          pw.SizedBox(width: 10),
          pw.Expanded(
              child: pw.Column(
                  crossAxisAlignment: pw.CrossAxisAlignment.start,
                  children: [
                pw.Text('BookADoctors',
                    style: pw.TextStyle(color: primary, fontSize: 19)),
                pw.Text(title, style: pw.TextStyle(color: muted, fontSize: 11)),
              ])),
        ]),
        pw.SizedBox(height: 8),
        pw.Text('Reference: $reference',
            style: pw.TextStyle(color: muted, fontSize: 8)),
      ]),
    ),
    footer: (context) => pw.Container(
        margin: const pw.EdgeInsets.only(top: 12),
        child: pw.Row(children: [
          pw.Expanded(
              child: pw.Text('bookadoctors.com | support@bookadoctors.com',
                  style: pw.TextStyle(color: muted, fontSize: 8))),
          pw.Text('${context.pageNumber} / ${context.pagesCount}',
              style: pw.TextStyle(color: muted, fontSize: 8)),
        ])),
    build: (_) => content,
  ));
  return document.save();
}

Future<void> shareBrandedPdf(
    {required String filename,
    required String title,
    required String reference,
    required String body}) async {
  final bytes =
      await buildBrandedPdf(title: title, reference: reference, body: body);
  await Share.shareXFiles(
      [XFile.fromData(bytes, mimeType: 'application/pdf', name: filename)],
      subject: title,
      fileNameOverrides: [filename]);
}
