import 'india_time.dart';

class AdminPeriod {
  const AdminPeriod(this.from, this.to);
  factory AdminPeriod.today() => AdminPeriod(indiaToday(), indiaToday());
  const AdminPeriod.all()
      : from = null,
        to = null;
  final String? from, to;
  bool get isAll => from == null && to == null;
  bool get isValid =>
      isAll || (from != null && to != null && from!.compareTo(to!) <= 0);
  String get label => isAll ? 'All dates' : '$from to $to';
  bool includes(String? raw) {
    if (isAll) return true;
    final day = indiaRecordDate(raw);
    return isValid &&
        day.isNotEmpty &&
        day.compareTo(from!) >= 0 &&
        day.compareTo(to!) <= 0;
  }

  Map<String, dynamic> get visitQuery =>
      isAll ? {} : {'dateFrom': from, 'dateTo': to};
}
