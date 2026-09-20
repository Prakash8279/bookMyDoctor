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
    testWidgets('PatientHomeScreen has exactly 15 items matching web Sidebar.jsx', (tester) async {
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
      expect(roleScaffold.items.length, 15);

      final expectedLabels = [
        'Dashboard',
        'Find doctors',
        'Book appointment',
        'My appointments',
        'Queue tracker',
        'Booking history',
        'Medical records',
        'Quick clinic booking',
        'Emergency care',
        'Payments',
        'Family members',
        'My reviews',
        'Help & complaints',
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
      expect(roleScaffold.items.length, 16);

      final expectedLabels = [
        'Dashboard',
        'Queue management',
        'Appointments',
        'Consultation & EMR',
        'Patients',
        'Analytics',
        'Patient reviews',
        'Notifications',
        'Clinic settings',
        'OPD schedule',
        'Fee management',
        'Payment setup',
        'Payment collections',
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

    testWidgets('ReceptionistHomeScreen has exactly 10 items matching web Sidebar.jsx', (tester) async {
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
      expect(roleScaffold.items.length, 10);

      final expectedLabels = [
        'Dashboard',
        'Walk-in registration',
        'Queue monitor',
        'Appointments',
        'Payments',
        'Patients',
        'Doctors & OPD',
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

    testWidgets('AdminHomeScreen has exactly 17 items matching web Sidebar.jsx', (tester) async {
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
        'Review moderation',
        'Complaints',
        'Contact inbox',
        'Broadcast',
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
  });
}

