import 'package:share_plus/share_plus.dart';

/// Shared "Export CSV" helper — ports client/src/lib/csv.js's `buildCsv`/`downloadCsv` pair
/// (COMPLETENESS FIX, mobile parity audit: several web screens have an "Export CSV" button with
/// no mobile equivalent). The web version triggers a browser file download; mobile has no
/// equivalent "save to Downloads" primitive without extra platform setup, so this shares the CSV
/// text directly via the OS share sheet (share_plus) — the receptionist/doctor/admin can save it
/// to Drive/WhatsApp/Files from there. Every quoting/escaping rule below matches csv.js exactly so
/// a file exported from mobile opens identically to one exported from web.
String buildCsv(List<String> headers, List<List<dynamic>> rows) {
  String escapeCell(dynamic value) {
    final cell = value?.toString() ?? '';
    if (cell.contains(',') || cell.contains('"') || cell.contains('\n')) {
      return '"${cell.replaceAll('"', '""')}"';
    }
    return cell;
  }

  final lines = <String>[
    headers.map(escapeCell).join(','),
    ...rows.map((row) => row.map(escapeCell).join(',')),
  ];
  return lines.join('\r\n');
}

/// Builds the CSV text via [buildCsv] and hands it to the OS share sheet under `filename`.
Future<void> shareCsv({
  required String filename,
  required List<String> headers,
  required List<List<dynamic>> rows,
}) async {
  final csv = buildCsv(headers, rows);
  await Share.share(csv, subject: filename);
}
