import 'package:flutter/material.dart';
import '../theme/app_theme.dart';

/// UI pagination is separate from API pagination: exports still use every loaded row.
class PagedRecordList<T> extends StatefulWidget {
  const PagedRecordList(
      {super.key,
      required this.items,
      required this.itemBuilder,
      this.shrinkWrap = false});
  final List<T> items;
  final Widget Function(BuildContext, T, int) itemBuilder;
  final bool shrinkWrap;
  @override
  State<PagedRecordList<T>> createState() => _PagedRecordListState<T>();
}

class _PagedRecordListState<T> extends State<PagedRecordList<T>> {
  int _page = 0;
  static const _pageSize = 25;
  @override
  Widget build(BuildContext context) {
    final pages = (widget.items.length / _pageSize).ceil().clamp(1, 1000000);
    final page = _page.clamp(0, pages - 1);
    final start = page * _pageSize;
    final end = (start + _pageSize).clamp(0, widget.items.length);
    return ListView(
      shrinkWrap: widget.shrinkWrap,
      physics: widget.shrinkWrap
          ? const NeverScrollableScrollPhysics()
          : const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.all(AppSpacing.md),
      children: [
        Wrap(
            spacing: 8,
            runSpacing: 4,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Text(
                  widget.items.isEmpty
                      ? '0 records'
                      : '${start + 1}–$end of ${widget.items.length}',
                  style: const TextStyle(fontSize: 12)),
              IconButton(
                  tooltip: 'Previous page',
                  onPressed:
                      page > 0 ? () => setState(() => _page = page - 1) : null,
                  icon: const Icon(Icons.chevron_left)),
              Text('Page ${page + 1} / $pages',
                  style: const TextStyle(fontSize: 12)),
              IconButton(
                  tooltip: 'Next page',
                  onPressed: page + 1 < pages
                      ? () => setState(() => _page = page + 1)
                      : null,
                  icon: const Icon(Icons.chevron_right)),
            ]),
        for (var i = start; i < end; i++)
          Padding(
              padding: const EdgeInsets.only(bottom: AppSpacing.sm),
              child: widget.itemBuilder(context, widget.items[i], i)),
      ],
    );
  }
}
