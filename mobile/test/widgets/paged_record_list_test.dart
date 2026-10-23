import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:connect_mobile/widgets/paged_record_list.dart';

void main() {
  testWidgets('UI pagination retains exact records and has working boundaries',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: PagedRecordList<int>(
                items: List.generate(51, (i) => i + 1),
                itemBuilder: (context, row, index) => Text('Record $row')))));
    expect(find.text('Page 1 / 3'), findsOneWidget);
    expect(find.text('Record 26'), findsNothing);
    await tester.tap(find.byTooltip('Next page'));
    await tester.pumpAndSettle();
    expect(find.text('Page 2 / 3'), findsOneWidget);
    expect(find.text('Record 26'), findsOneWidget);
    await tester.tap(find.byTooltip('Next page'));
    await tester.pumpAndSettle();
    expect(find.text('51–51 of 51'), findsOneWidget);
    expect(find.text('Record 51'), findsOneWidget);
    expect(
        tester
            .widget<IconButton>(find.byWidgetPredicate((widget) =>
                widget is IconButton && widget.tooltip == 'Next page'))
            .onPressed,
        isNull);
    await tester.tap(find.byTooltip('Previous page'));
    await tester.pumpAndSettle();
    expect(find.text('Page 2 / 3'), findsOneWidget);
  });
}
