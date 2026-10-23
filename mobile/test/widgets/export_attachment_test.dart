import 'dart:io';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:connect_mobile/core/csv_export.dart';
import 'package:connect_mobile/core/branded_pdf.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late Directory temporary;
  final calls = <MethodCall>[];
  setUp(() async {
    temporary =
        await Directory.systemTemp.createTemp('bookadoctors-export-fixture-');
    calls.clear();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
            const MethodChannel('plugins.flutter.io/path_provider'),
            (call) async => temporary.path);
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
            const MethodChannel('dev.fluttercommunity.plus/share'),
            (call) async {
      calls.add(call);
      return 'dev.fluttercommunity.plus/share/unavailable';
    });
  });
  test('CSV export reaches the OS boundary as a real named Unicode attachment',
      () async {
    await shareCsv(filename: 'appointments-2026-10-22.csv', headers: [
      'Patient',
      'Amount'
    ], rows: [
      ['प्रकाश कुमार', 500]
    ]);
    expect(calls.single.method, 'shareFiles');
    final paths = (calls.single.arguments as Map)['paths'] as List;
    expect(paths.single.toString(), endsWith('appointments-2026-10-22.csv'));
    final content = await File(paths.single as String).readAsString();
    expect(content, 'Patient,Amount\r\nप्रकाश कुमार,500');
    expect((await File(paths.single as String).readAsBytes()).take(3),
        [0xEF, 0xBB, 0xBF]);
    expect((calls.single.arguments as Map)['mimeTypes'], ['text/csv']);
  });
  test('PDF export reaches the OS boundary as a PDF file, never disguised text',
      () async {
    await shareBrandedPdf(
        filename: 'booking-test.pdf',
        title: 'Booking slip',
        reference: 'synthetic-booking',
        body: 'Name: Prakash Kumar\nToken: 1');
    expect(calls.single.method, 'shareFiles');
    final paths = (calls.single.arguments as Map)['paths'] as List;
    expect(paths.single.toString(), endsWith('booking-test.pdf'));
    final bytes = await File(paths.single as String).readAsBytes();
    expect(String.fromCharCodes(bytes.take(5)), '%PDF-');
    expect((calls.single.arguments as Map)['mimeTypes'], ['application/pdf']);
  });
}
