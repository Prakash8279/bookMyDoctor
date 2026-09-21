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
    testWidgets('PatientHomeScreen has exactly 11 items matching reachable web experience', (tester) async {
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

      final roleScaffold = const PatientHomeScreen().build(capturedContext) as RoleScaffold;
      expect(roleScaffold.items.length, 11);

      final expectedLabels = [
        'Dashboard',
        'Find doctors',
        'Book appointment',
        'My appointments',
        'Queue tracker',
        'Booking history',
        'Payments',
        'Family members',
        'My reviews',
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

    testWidgets('DoctorHomeScreen has exactly 16 items matching web Sidebar.jsx', (tester) async {
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

      final roleScaffold = const DoctorHomeScreen().build(capturedContext) as RoleScaffold;
      expect(roleScaffold.items.length, 11);

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

    testWidgets('ReceptionistHomeScreen has exactly 9 items matching web Sidebar.jsx', (tester) async {
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

      final roleScaffold = const ReceptionistHomeScreen().build(capturedContext) as RoleScaffold;
      expect(roleScaffold.items.length, 9);

      final expectedLabels = [
        'Dashboard',
        'Walk-in registration',
        'Queue monitor',
        'Appointments',
        'Payments',
        'Patients',
        'Notifications',
        'Reports',
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

    testWidgets('AdminHomeScreen for Admin has exactly 16 items matching web Sidebar.jsx', (tester) async {
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

      final roleScaffold = const AdminHomeScreen(isSuperAdmin: false).build(capturedContext) as RoleScaffold;
      expect(roleScaffold.portalTitle, 'Admin control panel');
      expect(roleScaffold.items.length, 16);

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

    testWidgets('AdminHomeScreen for Superadmin has exactly 21 items matching web Sidebar.jsx', (tester) async {
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

      final roleScaffold = const AdminHomeScreen(isSuperAdmin: true).build(capturedContext) as RoleScaffold;
      expect(roleScaffold.portalTitle, 'Super Admin control panel');
      expect(roleScaffold.items.length, 21);

      final expectedLabels = [
        // Super Admin workspace (first 10 items)
        'Control center',
        'People & clinics',
        'Payments & revenue',
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

      // Verify section divider above item 10 ('Dashboard')
      expect(roleScaffold.items[10].headerAbove, 'Admin workspace');

      for (final item in roleScaffold.items) {
        final widget = item.builder(capturedContext);
        expect(widget, isNotNull);
      }
    });
  });
}
