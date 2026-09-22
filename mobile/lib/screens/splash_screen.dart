import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

/// Shown for the brief moment while AuthProvider.bootstrap() is checking for
/// a saved session — deliberately minimal, this should never be on screen
/// for more than a few hundred ms in practice.
class SplashScreen extends StatelessWidget {
  const SplashScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      // COMPLETENESS FIX (brand consistency): shows the actual brand mark
      // (assets/branding/app_icon.png — same image as the web favicon/sidebar and the launcher
      // icon, see pubspec.yaml's flutter_launcher_icons config) instead of a generic Material
      // icon. White backdrop rather than AppColors.primary behind it — that accent color predates
      // this mark and doesn't match its terracotta tone, so placing the image straight on it
      // would show a visible seam.
      backgroundColor: Colors.white,
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Image(image: AssetImage('assets/branding/app_icon.png'), width: 96, height: 96),
            SizedBox(height: AppSpacing.md),
            Text(
              'BookMyDoctors',
              style: TextStyle(color: AppColors.primary, fontSize: 22, fontWeight: FontWeight.w700),
            ),
            SizedBox(height: AppSpacing.lg),
            SizedBox(
              width: 28,
              height: 28,
              child: CircularProgressIndicator(strokeWidth: 2.5, color: AppColors.primary),
            ),
          ],
        ),
      ),
    );
  }
}
