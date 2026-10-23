import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:connect_mobile/screens/admin/admin_home_screen.dart';
import 'package:connect_mobile/screens/doctor/doctor_home_screen.dart';
import 'package:connect_mobile/screens/patient/patient_home_screen.dart';
import 'package:connect_mobile/screens/receptionist/receptionist_home_screen.dart';
import 'package:connect_mobile/widgets/role_scaffold.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('Portal Nav & Feature Parity Tests', () {
    testWidgets('PatientHomeScreen exposes all patient workflows',
        (tester) async {
      late BuildContext capturedContext;
      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) {
              capturedContext = context;
              return const SizedBox.shrink();
            },
          ),
        ),
      );

      final roleScaffold =
          const PatientHomeScreen().build(capturedContext) as RoleScaffold;
      expect(roleScaffold.items.length, 11);

      final expectedLabels = [
        'Dashboard',
        'Book appointment',
        'My appointments',
        'Queue tracker',
        'Booking history',
        'Payments',
        'Family members',
        'My reviews',
        'Help & Policies',
        'Notifications',
        'My profile',
      ];

      for (int i = 0; i < expectedLabels.length; i++) {
        expect(roleScaffold.items[i].label, expectedLabels[i]);
      }

      for (final item in roleScaffold.items) {
        final widget = item.builder(capturedContext);
        expect(widget, isNotNull);
      }
    });

    testWidgets('DoctorHomeScreen matches the web doctor navigation',
        (tester) async {
      late BuildContext capturedContext;
      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) {
              capturedContext = context;
              return const SizedBox.shrink();
            },
          ),
        ),
      );

      final roleScaffold =
          const DoctorHomeScreen().build(capturedContext) as RoleScaffold;
      expect(roleScaffold.items.length, 12);

      final expectedLabels = [
        'Dashboard',
        'Queue management',
        'Appointments',
        'Analytics',
        'Patient reviews',
        'Notifications',
        'Clinic settings',
        'OPD schedule',
        'Receptionists',
        'Reports',
        'Help & Policies',
        'My profile',
      ];

      for (int i = 0; i < expectedLabels.length; i++) {
        expect(roleScaffold.items[i].label, expectedLabels[i]);
      }

      for (final item in roleScaffold.items) {
        final widget = item.builder(capturedContext);
        expect(widget, isNotNull);
      }
    });

    testWidgets(
        'ReceptionistHomeScreen matches the web receptionist navigation',
        (tester) async {
      late BuildContext capturedContext;
      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) {
              capturedContext = context;
              return const SizedBox.shrink();
            },
          ),
        ),
      );

      final roleScaffold =
          const ReceptionistHomeScreen().build(capturedContext) as RoleScaffold;
      expect(roleScaffold.items.length, 12);

      final expectedLabels = [
        'Dashboard',
        'Walk-in registration',
        'Queue monitor',
        'Check-in',
        'Appointments',
        'Doctor availability',
        'Payments',
        'Patients',
        'Notifications',
        'Reports',
        'Help & Policies',
        'My profile',
      ];

      for (int i = 0; i < expectedLabels.length; i++) {
        expect(roleScaffold.items[i].label, expectedLabels[i]);
      }

      for (final item in roleScaffold.items) {
        final widget = item.builder(capturedContext);
        expect(widget, isNotNull);
      }
    });

    testWidgets('AdminHomeScreen for Admin includes payment operations',
        (tester) async {
      late BuildContext capturedContext;
      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) {
              capturedContext = context;
              return const SizedBox.shrink();
            },
          ),
        ),
      );

      final roleScaffold = const AdminHomeScreen(isSuperAdmin: false)
          .build(capturedContext) as RoleScaffold;
      expect(roleScaffold.portalTitle, 'Admin control panel');
      expect(roleScaffold.items.length, 17);

      final expectedLabels = [
        'Dashboard',
        'Doctors',
        'Patients',
        'Receptionists',
        'Clinics',
        'Cities & areas',
        'Specializations',
        'Appointments',
        'Revenue',
        'Refunds & reconciliation',
        'Review moderation',
        'Complaints',
        'Contact inbox',
        'Notifications',
        'Activity logs',
        'Settings',
        'My profile',
      ];

      for (int i = 0; i < expectedLabels.length; i++) {
        expect(roleScaffold.items[i].label, expectedLabels[i]);
      }

      for (final item in roleScaffold.items) {
        final widget = item.builder(capturedContext);
        expect(widget, isNotNull);
      }
    });

    testWidgets('AdminHomeScreen for Superadmin includes payment operations',
        (tester) async {
      late BuildContext capturedContext;
      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) {
              capturedContext = context;
              return const SizedBox.shrink();
            },
          ),
        ),
      );

      final roleScaffold = const AdminHomeScreen(isSuperAdmin: true)
          .build(capturedContext) as RoleScaffold;
      expect(roleScaffold.portalTitle, 'Super Admin control panel');
      expect(roleScaffold.items.length, 22);

      final expectedLabels = [
        // Super Admin workspace (first 10 items)
        'Control center',
        'People & clinics',
        'Payments & revenue',
        'Refunds & reconciliation',
        'Platform charges',
        'Cities & service areas',
        'Clinic tenants',
        'Security & activity',
        'Content & broadcasts',
        'System settings',
        'My profile',
        // Admin workspace divider (items 11-21)
        'Dashboard',
        'Doctors',
        'Clinic verification',
        'Patients',
        'Specializations',
        'Appointments',
        'Booking rules',
        'Receptionists',
        'Reviews',
        'Complaints',
        'Contact inbox',
      ];

      for (int i = 0; i < expectedLabels.length; i++) {
        expect(roleScaffold.items[i].label, expectedLabels[i]);
      }

      // Verify section divider above item 11 ('Dashboard')
      expect(roleScaffold.items[11].headerAbove, 'Admin workspace');

      for (final item in roleScaffold.items) {
        final widget = item.builder(capturedContext);
        expect(widget, isNotNull);
      }
    });
  });
}
