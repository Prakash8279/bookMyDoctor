import 'package:flutter_test/flutter_test.dart';
import 'package:connect_mobile/core/admin_period.dart';

void main() {
  test('period uses the India day and includes both date boundaries', () {
    const period = AdminPeriod('2026-10-22', '2026-10-23');
    expect(period.includes('2026-10-21T18:30:00Z'), isTrue);
    expect(period.includes('2026-10-23T18:29:59Z'), isTrue);
    expect(period.includes('2026-10-23T18:30:00Z'), isFalse);
    expect(period.includes('2026-10-21T18:29:59Z'), isFalse);
    expect(period.includes(null), isFalse);
    expect(period.includes('bad-date'), isFalse);
  });
  test('all dates explicitly retains undated legacy records', () {
    expect(const AdminPeriod.all().includes(null), isTrue);
    expect(const AdminPeriod.all().visitQuery, isEmpty);
    expect(const AdminPeriod('2026-10-23', '2026-10-22').isValid, isFalse);
  });
}
