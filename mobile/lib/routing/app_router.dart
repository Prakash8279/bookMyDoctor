import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../screens/admin/admin_home_screen.dart';
import '../screens/auth/forgot_password_screen.dart';
import '../screens/auth/login_screen.dart';
import '../screens/auth/register_screen.dart';
import '../screens/auth/reset_password_screen.dart';
import '../screens/doctor/doctor_home_screen.dart';
import '../screens/guest/guest_home_screen.dart';
import '../screens/patient/patient_home_screen.dart';
import '../screens/receptionist/receptionist_home_screen.dart';
import '../screens/splash_screen.dart';
import '../state/auth_provider.dart';

/// Route names used with Navigator.pushNamed throughout the app — kept in
/// one place so a typo in a route string is easy to spot by search.
class Routes {
  Routes._();
  static const login = '/login';
  static const register = '/register';
  // COMPLETENESS FIX (audit Priority 3 #2 — mobile parity): forgot/reset password had no screen
  // or link anywhere on mobile — see forgot_password_screen.dart / reset_password_screen.dart.
  static const forgotPassword = '/forgot-password';
  static const resetPassword = '/reset-password';
}

/// Root widget: watches [AuthProvider] and decides between splash / login /
/// the correct role's home shell. This is deliberately simple (no deep-link
/// routing table) — within a role's home shell, screens are pushed with
/// normal Navigator.push(MaterialPageRoute) calls.
class AppRoot extends StatelessWidget {
  const AppRoot({super.key});

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();

    switch (auth.status) {
      case AuthStatus.unknown:
        return const SplashScreen();
      case AuthStatus.loggedOut:
        // WEBSITE PARITY ("app open hote public page ho jaise website hai"): the real site's "/"
        // is the public PatientLanding page, not the login form — login is reached FROM there.
        // GuestHomeScreen already mirrors that page section-by-section (see its doc comment), so
        // it — not LoginScreen — is now the default screen for a signed-out user. Login stays one
        // tap away via the AppBar action and footer link on GuestHomeScreen.
        return const GuestHomeScreen();
      case AuthStatus.loggedIn:
        return _RoleHome(role: auth.role);
    }
  }
}

class _RoleHome extends StatelessWidget {
  final String role;
  const _RoleHome({required this.role});

  @override
  Widget build(BuildContext context) {
    switch (role) {
      case 'doctor':
        return const DoctorHomeScreen();
      case 'patient':
        return const PatientHomeScreen();
      case 'receptionist':
        return const ReceptionistHomeScreen();
      case 'admin':
      case 'superadmin':
        return AdminHomeScreen(isSuperAdmin: role == 'superadmin');
      default:
        // Should never happen (backend only issues these 5 roles), but fail
        // safe into the login screen rather than a blank/crashed screen.
        return const LoginScreen();
    }
  }
}

/// Named route generator for the auth-flow screens the login screen links
/// out to (register). Role home shells use direct Navigator.push for their
/// own sub-screens rather than named routes, so this table stays small.
Route<dynamic> onGenerateRoute(RouteSettings settings) {
  switch (settings.name) {
    case Routes.register:
      return MaterialPageRoute(builder: (_) => const RegisterScreen());
    case Routes.forgotPassword:
      return MaterialPageRoute(builder: (_) => const ForgotPasswordScreen());
    case Routes.resetPassword:
      return MaterialPageRoute(builder: (_) => const ResetPasswordScreen());
    case Routes.login:
      return MaterialPageRoute(builder: (_) => const LoginScreen());
    default:
      return MaterialPageRoute(builder: (_) => const LoginScreen());
  }
}
