import 'package:flutter/material.dart';
import '../core/admin_period.dart';
import '../core/csv_export.dart';
import '../theme/app_theme.dart';
import 'admin_period_filter.dart';
import 'paged_record_list.dart';
import 'common_widgets.dart';

class AdminRecordPanel<T> extends StatefulWidget {
  const AdminRecordPanel(
      {super.key,
      required this.items,
      required this.dateOf,
      required this.headers,
      required this.rowOf,
      required this.filename,
      required this.itemBuilder,
      this.shrinkWrap = false});
  final List<T> items;
  final String? Function(T) dateOf;
  final List<String> headers;
  final List<dynamic> Function(T) rowOf;
  final String filename;
  final Widget Function(BuildContext, T, int) itemBuilder;
  final bool shrinkWrap;
  @override
  State<AdminRecordPanel<T>> createState() => _AdminRecordPanelState<T>();
}

class _AdminRecordPanelState<T> extends State<AdminRecordPanel<T>> {
  AdminPeriod _period = AdminPeriod.today();
  Future<void> _export(List<T> rows) async {
    try {
      await shareCsv(
          filename:
              '${widget.filename}-${_period.from ?? 'all'}-to-${_period.to ?? 'all'}.csv',
          headers: widget.headers,
          rows: rows.map(widget.rowOf).toList());
    } catch (error) {
      if (mounted) showErrorSnack(context, error);
    }
  }

  @override
  Widget build(BuildContext context) {
    final visible = widget.items
        .where((item) => _period.includes(widget.dateOf(item)))
        .toList();
    final list = visible.isEmpty
        ? Padding(
            padding: const EdgeInsets.all(AppSpacing.md),
            child: Text(
                'No records in this period. Choose All dates to include older or undated records.',
                style: TextStyle(color: context.palette.textSecondary)))
        : PagedRecordList<T>(
            key: ValueKey(_period.label),
            items: visible,
            itemBuilder: widget.itemBuilder,
            shrinkWrap: widget.shrinkWrap);
    return Column(
        mainAxisSize: widget.shrinkWrap ? MainAxisSize.min : MainAxisSize.max,
        children: [
          Padding(
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
              child: AdminPeriodFilter(
                  value: _period,
                  onChanged: (period) => setState(() => _period = period))),
          Align(
              alignment: Alignment.centerRight,
              child: TextButton.icon(
                  onPressed: visible.isEmpty || !_period.isValid
                      ? null
                      : () => _export(visible),
                  icon: const Icon(Icons.download_outlined),
                  label: const Text('Export CSV'))),
          if (widget.shrinkWrap) list else Expanded(child: list),
        ]);
  }
}
