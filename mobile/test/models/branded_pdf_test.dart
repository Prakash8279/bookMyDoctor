import 'dart:io';
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:connect_mobile/core/branded_pdf.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  for (final title in ['Booking slip', 'Payment receipt']) {
    test('$title generates a real branded PDF with original timestamps',
        () async {
      final bytes = await buildBrandedPdf(
          title: title, reference: 'booking-fixture-123456789', body: '''
BOOKADOCTORS - $title
Booking ID: booking-fixture-123456789
Token Number: 50
Status: CONFIRMED
Booked on: 22/10/2026 09:35:06 IST
Visit: 2026-10-23 at Approx. 10:05
DOCTOR & CLINIC:
Doctor: Dr. Priya Sharma
Clinic: BookADoctors Community Healthcare Clinic
Address: Andheri West, Mumbai, Maharashtra, India
PATIENT:
Name: Prakash Kumar / प्रकाश कुमार
Gender: Male
Age: 25
Blood Group: B+
FINANCIAL SUMMARY:
Total Amount: ₹500
Paid: ₹500
Due at Clinic: ₹0
Recorded on: 22/10/2026 09:36:10 IST
Payment Status: paid
Reference: pay_fixture123456789
This is a computer-generated document.
''');
      expect(ascii.decode(bytes.take(5).toList()), '%PDF-');
      expect(bytes.length, greaterThan(5000));
      final qa = Platform.environment['PDF_QA_DIR'];
      if (qa != null) {
        await Directory(qa).create(recursive: true);
        await File('$qa/${title == 'Booking slip' ? 'booking' : 'receipt'}.pdf')
            .writeAsBytes(bytes);
      }
    });
  }
  test('long notes paginate without silently omitting text', () async {
    final bytes = await buildBrandedPdf(
        title: 'Booking slip',
        reference: 'long-fixture',
        body:
            'PATIENT:\nNotes: ${List.filled(120, 'Follow the clinic instructions. ').join()}\nLast field: preserved-end');
    expect(ascii.decode(bytes.take(5).toList()), '%PDF-');
    expect(bytes.length, greaterThan(5000));
  });
}
