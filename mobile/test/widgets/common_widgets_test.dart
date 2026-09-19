import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:connect_mobile/widgets/common_widgets.dart';

void main() {
  group('PageHeader', () {
    testWidgets('always renders the title', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: PageHeader(title: 'My Appointments'),
          ),
        ),
      );

      expect(find.text('My Appointments'), findsOneWidget);
    });

    testWidgets('renders the kicker (uppercased) only when provided', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: PageHeader(title: 'My Appointments', kicker: 'schedule'),
          ),
        ),
      );

      expect(find.text('My Appointments'), findsOneWidget);
      expect(find.text('SCHEDULE'), findsOneWidget);
    });

    testWidgets('omits the kicker text when not provided', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: PageHeader(title: 'My Appointments'),
          ),
        ),
      );

      expect(find.text('SCHEDULE'), findsNothing);
    });

    testWidgets('renders the subtitle only when provided', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: PageHeader(
              title: 'My Appointments',
              subtitle: 'Upcoming and past visits',
            ),
          ),
        ),
      );

      expect(find.text('Upcoming and past visits'), findsOneWidget);
    });

    testWidgets('omits the subtitle when not provided', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: PageHeader(title: 'My Appointments'),
          ),
        ),
      );

      expect(find.text('Upcoming and past visits'), findsNothing);
    });

    testWidgets('renders the trailing action widget when provided', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: PageHeader(
              title: 'My Appointments',
              action: Icon(Icons.add),
            ),
          ),
        ),
      );

      expect(find.byIcon(Icons.add), findsOneWidget);
    });
  });

  group('EmptyStateView', () {
    testWidgets('always renders the title and the default icon', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: EmptyStateView(title: 'No appointments yet'),
          ),
        ),
      );

      expect(find.text('No appointments yet'), findsOneWidget);
      expect(find.byIcon(Icons.inbox_outlined), findsOneWidget);
    });

    testWidgets('renders a custom icon when provided', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: EmptyStateView(
              title: 'No appointments yet',
              icon: Icons.calendar_today,
            ),
          ),
        ),
      );

      expect(find.byIcon(Icons.calendar_today), findsOneWidget);
      expect(find.byIcon(Icons.inbox_outlined), findsNothing);
    });

    testWidgets('renders the subtitle only when provided', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: EmptyStateView(
              title: 'No appointments yet',
              subtitle: 'Book your first appointment to see it here',
            ),
          ),
        ),
      );

      expect(find.text('Book your first appointment to see it here'), findsOneWidget);
    });

    testWidgets('omits the subtitle when not provided', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: EmptyStateView(title: 'No appointments yet'),
          ),
        ),
      );

      expect(find.text('Book your first appointment to see it here'), findsNothing);
    });

    testWidgets('renders the action widget only when provided', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: EmptyStateView(
              title: 'No appointments yet',
              action: ElevatedButton(onPressed: () {}, child: const Text('Book now')),
            ),
          ),
        ),
      );

      expect(find.text('Book now'), findsOneWidget);
    });

    testWidgets('omits the action widget when not provided', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: EmptyStateView(title: 'No appointments yet'),
          ),
        ),
      );

      expect(find.text('Book now'), findsNothing);
    });
  });

  group('StatusBadge', () {
    testWidgets('renders the status text with underscores replaced by spaces', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: StatusBadge(status: 'in_progress'),
          ),
        ),
      );

      expect(find.text('in progress'), findsOneWidget);
      expect(find.text('in_progress'), findsNothing);
    });

    testWidgets('renders a status with no underscores unchanged', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: StatusBadge(status: 'confirmed'),
          ),
        ),
      );

      expect(find.text('confirmed'), findsOneWidget);
    });
  });
}
