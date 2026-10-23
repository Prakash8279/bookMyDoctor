import 'package:intl/intl.dart';

DateTime indiaClock([DateTime? instant]) => (instant ?? DateTime.now())
    .toUtc()
    .add(const Duration(hours: 5, minutes: 30));
String indiaToday([DateTime? instant]) =>
    DateFormat('yyyy-MM-dd').format(indiaClock(instant));
String indiaRecordDate(String? value) {
  if (value == null || value.isEmpty) return '';
  if (RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(value)) return value;
  final instant = DateTime.tryParse(value);
  return instant == null ? '' : indiaToday(instant);
}

String indiaTimestamp(String? value) {
  if (value == null ||
      !RegExp(r'T.*(?:Z|[+-]\d{2}:\d{2})$', caseSensitive: false)
          .hasMatch(value)) {
    return 'Not recorded';
  }
  final instant = DateTime.tryParse(value);
  return instant == null
      ? 'Not recorded'
      : '${DateFormat('dd/MM/yyyy HH:mm:ss').format(indiaClock(instant))} IST';
}
