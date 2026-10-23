import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:connect_mobile/core/india_time.dart';
import 'package:connect_mobile/widgets/admin_record_panel.dart';

void main() {
  testWidgets(
      'today hides historical records; All dates restores and paginates them',
      (tester) async {
    final rows = List.generate(
        27,
        (i) =>
            {'id': 'Entry $i', 'date': i == 0 ? indiaToday() : '2020-01-01'});
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: AdminRecordPanel<Map<String, String>>(
      items: rows,
      dateOf: (row) => row['date'],
      filename: 'audit-test',
      headers: const ['ID', 'Date'],
      rowOf: (row) => [row['id'], row['date']],
      itemBuilder: (_, row, index) => Text(row['id']!),
    ))));
    expect(find.text('Entry 0'), findsOneWidget);
    expect(find.text('Entry 1'), findsNothing);
    await tester.tap(find.text('All dates'));
    await tester.pumpAndSettle();
    expect(find.text('Page 1 / 2'), findsOneWidget);
    await tester.tap(find.byTooltip('Next page'));
    await tester.pumpAndSettle();
    expect(find.text('Entry 26'), findsOneWidget);
    await tester.tap(find.text('Today'));
    await tester.pumpAndSettle();
    expect(find.text('Entry 0'), findsOneWidget);
    expect(find.text('Entry 26'), findsNothing);
    expect(tester.takeException(), isNull);
  });
}
