import 'package:flutter_test/flutter_test.dart';
import 'package:connect_mobile/core/csv_export.dart';

void main() {
  test('CSV preserves commas, quotes, unicode and carriage returns', () {
    expect(
        buildCsv([
          'Name',
          'Note'
        ], [
          ['प्रकाश', 'a,"b"\rc']
        ]),
        'Name,Note\r\nप्रकाश,"a,""b""\rc"');
  });
  test('CSV guards spreadsheet formulas without changing numeric values', () {
    expect(
        buildCsv([
          'Name',
          'Amount'
        ], [
          [' =HYPERLINK("x")', -5]
        ]),
        'Name,Amount\r\n"\' =HYPERLINK(""x"")",-5');
  });
}
