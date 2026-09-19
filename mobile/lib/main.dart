import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'routing/app_router.dart';
import 'state/auth_provider.dart';
import 'theme/app_theme.dart';

void main() {
  runApp(const BookMyDoctor24App());
}

class BookMyDoctor24App extends StatelessWidget {
  const BookMyDoctor24App({super.key});

  @override
  Widget build(BuildContext context) {
    return ChangeNotifierProvider(
      create: (_) => AuthProvider()..bootstrap(),
      child: MaterialApp(
        title: 'BookMyDoctor24',
        debugShowCheckedModeBanner: false,
        theme: AppTheme.light,
        onGenerateRoute: onGenerateRoute,
        home: const AppRoot(),
      ),
    );
  }
}
