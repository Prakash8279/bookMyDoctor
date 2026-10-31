import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:connect_mobile/models/core_models.dart';
import 'package:connect_mobile/screens/patient/patient_home_screen.dart';
import 'package:connect_mobile/screens/doctor/doctor_home_screen.dart';
import 'package:connect_mobile/screens/receptionist/receptionist_home_screen.dart';
import 'package:connect_mobile/state/auth_provider.dart';
import 'package:connect_mobile/theme/app_theme.dart';
import 'package:connect_mobile/widgets/role_scaffold.dart';

List<String> labels(String block) => RegExp(r"\['([^']+)',\s*'/")
    .allMatches(block)
    .map((match) => match[1]!)
    .toList();

void main() {
  for (final role in ['patient', 'doctor', 'receptionist']) {
    testWidgets(
        '$role shortcuts and footer match the website, without extra mobile options',
        (tester) async {
      final web = File(
              '../client/src/pages/${role == 'patient' ? 'PatientPages' : 'StaffPages'}.jsx')
          .readAsStringSync();
      final block = role == 'patient'
          ? RegExp(r'const PATIENT_SERVICES = \[([\s\S]*?)\n\]')
              .firstMatch(web)![1]!
          : RegExp('$role: \\[([\\s\\S]*?)\\n  \\]').firstMatch(web)![1]!;
      final expected = labels(block);
      final footer =
          File('../client/src/layouts/PortalLayout.jsx').readAsStringSync();
      final footerBlock =
          RegExp('$role: \\[([\\s\\S]*?)\\n').firstMatch(footer)![1]!;
      final expectedFooter = labels(footerBlock);
      late RoleScaffold original;
      await tester.pumpWidget(MaterialApp(home: Builder(builder: (context) {
        original = switch (role) {
          'patient' => const PatientHomeScreen().build(context) as RoleScaffold,
          'doctor' => const DoctorHomeScreen().build(context) as RoleScaffold,
          _ => const ReceptionistHomeScreen().build(context) as RoleScaffold,
        };
        return const SizedBox.shrink();
      })));
      final auth = AuthProvider()
        ..status = AuthStatus.loggedIn
        ..user = AppUser(
            id: 'fixture',
            name: 'Test',
            email: 'test@example.test',
            role: role);
      tester.view.physicalSize = const Size(320, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(ChangeNotifierProvider.value(
          value: auth,
          child: MaterialApp(
            theme: AppTheme.light,
            home: RoleScaffold(portalTitle: original.portalTitle, items: [
              for (final item in original.items)
                RoleNavItem(
                    icon: item.icon,
                    label: item.label,
                    builder: (_) => item.label == 'Dashboard'
                        ? const SingleChildScrollView(
                            child: PortalQuickActions())
                        : Text(item.label)),
            ]),
          )));
      await tester.pumpAndSettle();
      final shortcuts = tester
          .widgetList<Tooltip>(find.descendant(
              of: find.byType(PortalQuickActions),
              matching: find.byType(Tooltip)))
          .map((widget) => widget.message)
          .toList();
      expect(shortcuts, expected);
      final state = tester.state<RoleScaffoldState>(find.byType(RoleScaffold));
      expect(
          state.bottomDestinations.map((entry) => entry.value), expectedFooter);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
      auth.dispose();
    });
  }
}
