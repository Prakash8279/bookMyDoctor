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

    testWidgets('stacks a long action below the heading on a narrow phone', (tester) async {
      tester.view.physicalSize = const Size(320, 700);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: PageHeader(
              title: 'Appointments and medical records',
              subtitle: 'Manage every visit from one place',
              action: ElevatedButton(
                onPressed: () {},
                child: const Text('Create a new appointment'),
              ),
            ),
          ),
        ),
      );

      expect(tester.takeException(), isNull);
      final titleBottom = tester.getBottomLeft(find.text('Appointments and medical records')).dy;
      final actionTop = tester.getTopLeft(find.text('Create a new appointment')).dy;
      expect(actionTop, greaterThan(titleBottom));
    });
  });

  group('narrow layout safety', () {
    testWidgets('PrimaryButton keeps a long label inside a 280px card', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Center(
              child: SizedBox(
                width: 280,
                child: PrimaryButton(
                  label: 'Continue to secure appointment payment',
                  onPressed: () {},
                ),
              ),
            ),
          ),
        ),
      );

      expect(tester.takeException(), isNull);
      expect(find.text('Continue to secure appointment payment'), findsOneWidget);
    });

    testWidgets('SectionCard stacks a long trailing action on a narrow phone', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SizedBox(
              width: 320,
              child: SectionCard(
                title: 'Upcoming appointments',
                trailing: TextButton(
                  onPressed: () {},
                  child: const Text('View complete appointment history'),
                ),
                child: const Text('No appointments yet'),
              ),
            ),
          ),
        ),
      );

      expect(tester.takeException(), isNull);
      final titleBottom = tester.getBottomLeft(find.text('Upcoming appointments')).dy;
      final actionTop = tester.getTopLeft(find.text('View complete appointment history')).dy;
      expect(actionTop, greaterThan(titleBottom));
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
