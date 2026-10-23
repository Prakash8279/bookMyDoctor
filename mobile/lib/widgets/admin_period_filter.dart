import 'package:flutter/material.dart';
import '../core/admin_period.dart';
import '../core/india_time.dart';
import '../theme/app_theme.dart';

class AdminPeriodFilter extends StatelessWidget {
  const AdminPeriodFilter(
      {super.key, required this.value, required this.onChanged});
  final AdminPeriod value;
  final ValueChanged<AdminPeriod> onChanged;
  Future<void> _pick(BuildContext context, bool start) async {
    final now = DateTime.parse(indiaToday());
    final raw = (start ? value.from : value.to) ?? indiaToday();
    final date = await showDatePicker(
        context: context,
        initialDate: DateTime.parse(raw),
        firstDate: DateTime(2000),
        lastDate: DateTime(now.year + 5, 12, 31));
    if (date == null) return;
    final selected =
        '${date.year}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}';
    final next = AdminPeriod(start ? selected : (value.from ?? selected),
        start ? (value.to ?? selected) : selected);
    onChanged(next);
  }

  @override
  Widget build(BuildContext context) =>
      Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Wrap(
            spacing: 8,
            runSpacing: 6,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              OutlinedButton(
                  onPressed: () => _pick(context, true),
                  child: Text('From: ${value.from ?? 'All'}',
                      style: const TextStyle(fontSize: 12))),
              OutlinedButton(
                  onPressed: () => _pick(context, false),
                  child: Text('To: ${value.to ?? 'All'}',
                      style: const TextStyle(fontSize: 12))),
              TextButton(
                  onPressed: () => onChanged(AdminPeriod.today()),
                  child: const Text('Today')),
              TextButton(
                  onPressed: () => onChanged(const AdminPeriod.all()),
                  child: const Text('All dates')),
            ]),
        if (!value.isValid)
          Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text('Start date must be on or before end date.',
                  style: TextStyle(color: context.palette.danger))),
      ]);
}
