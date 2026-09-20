import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// Shared visual language for the whole app — every screen pulls colors/
/// spacing from here rather than hardcoding values, so the 4 role portals
/// feel like one product.
///
/// COMPLETENESS FIX (brand consistency — user asked for the mobile app to look
/// "same to same" as the website): these values are lifted directly from the
/// web app's own design tokens (client/tailwind.config.js `theme.extend.colors`
/// and the compiled --css-vars in reference_site.css), not approximated —
/// AppColors.primary previously used a brighter, unrelated orange (#EA580C)
/// that matched neither the web app's real accent (#ad5d3b) nor the app's own
/// new launcher icon/logo.
class AppColors {
  AppColors._();

  static const primary = Color(0xFFAD5D3B); // web tailwind.config.js colors.primary.DEFAULT
  static const primaryDark = Color(0xFF8E482D); // colors.primary.dark
  static const primaryLight = Color(0xFFF5E9E3); // colors.primary.light
  static const primaryContrast = Color(0xFF7F422D); // colors.primary.contrast
  static const teal = Color(0xFFC17655); // colors.teal.DEFAULT
  static const tealDark = Color(0xFF8E482D); // colors.teal.dark
  static const gold = Color(0xFFFFC107); // colors.gold.DEFAULT
  static const goldDark = Color(0xFFB77900); // colors.gold.dark
  static const charcoal = Color(0xFF1B1917); // colors.charcoal — web's sidebar/footer background
  static const background = Color(0xFFF8F6F3); // colors.surface — web's page background
  static const surface = Color(0xFFFFFFFF); // web cards sit on plain white over that page background
  static const textPrimary = Color(0xFF1D1B19); // colors.ink
  static const textSecondary = Color(0xFF6F6A64); // colors.muted
  static const border = Color(0xFFE9E5E0); // colors.border
  static const success = Color(0xFF198754); // colors.success
  static const warning = Color(0xFFFFC107); // same value as gold — web has no separate "warning" token
  static const danger = Color(0xFFDC3545); // colors.error
  static const info = Color(0xFF2563EB); // web has no blue "info" tone; kept only for any residual use
}

class AppSpacing {
  AppSpacing._();

  static const xs = 4.0;
  static const sm = 8.0;
  static const md = 16.0;
  static const lg = 24.0;
  static const xl = 32.0;
}

/// web tailwind.config.js theme.extend.borderRadius
class AppRadius {
  AppRadius._();

  static const button = 8.0; // 0.5rem
  static const card = 14.0; // 0.875rem
  static const pill = 999.0;
}

class AppTheme {
  AppTheme._();

  static ThemeData get light {
    // web's actual rendered font stack is just Inter everywhere (reference_site.css's one
    // `font-family:Inter,...` base rule) — tailwind.config.js also declares a 'heading' family
    // (Poppins) but no component in the codebase ever applies it, so porting it here would be
    // matching a font the website itself never shows.
    final textTheme = GoogleFonts.interTextTheme();

    final base = ThemeData(
      useMaterial3: true,
      colorScheme: ColorScheme.fromSeed(
        seedColor: AppColors.primary,
        primary: AppColors.primary,
        secondary: AppColors.teal,
        error: AppColors.danger,
        brightness: Brightness.light,
      ),
      scaffoldBackgroundColor: AppColors.background,
      fontFamily: textTheme.bodyMedium?.fontFamily,
    );

    return base.copyWith(
      textTheme: textTheme.apply(
        bodyColor: AppColors.textPrimary,
        displayColor: AppColors.textPrimary,
      ),
      appBarTheme: AppBarTheme(
        backgroundColor: AppColors.background,
        foregroundColor: AppColors.textPrimary,
        elevation: 0,
        centerTitle: false,
        surfaceTintColor: Colors.transparent,
        titleTextStyle: GoogleFonts.inter(
          color: AppColors.textPrimary,
          fontSize: 18,
          fontWeight: FontWeight.w700,
        ),
      ),
      cardTheme: CardThemeData(
        color: AppColors.surface,
        elevation: 1,
        shadowColor: AppColors.charcoal.withValues(alpha: 0.12),
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadius.card),
          side: const BorderSide(color: AppColors.border),
        ),
        margin: EdgeInsets.zero,
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: AppColors.surface,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppRadius.button),
          borderSide: const BorderSide(color: AppColors.border),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppRadius.button),
          borderSide: const BorderSide(color: AppColors.border),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppRadius.button),
          borderSide: const BorderSide(color: AppColors.primary, width: 1.5),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppRadius.button),
          borderSide: const BorderSide(color: AppColors.danger),
        ),
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: AppColors.primary,
          foregroundColor: Colors.white,
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.button)),
          textStyle: const TextStyle(fontWeight: FontWeight.w600),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: AppColors.textPrimary,
          side: const BorderSide(color: AppColors.border),
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.button)),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(foregroundColor: AppColors.primaryDark),
      ),
      chipTheme: base.chipTheme.copyWith(
        selectedColor: AppColors.primaryLight,
        labelStyle: const TextStyle(color: AppColors.textPrimary),
        secondarySelectedColor: AppColors.primaryLight,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
        side: const BorderSide(color: AppColors.border),
      ),
      dividerTheme: const DividerThemeData(color: AppColors.border, thickness: 1),
      drawerTheme: const DrawerThemeData(backgroundColor: AppColors.charcoal),
    );
  }
}

/// A status pill's background + text color as a pair — mirrors the web app's
/// Badge/StatusPill components (src/components/Badge.jsx + StatusPill.jsx)
/// tone-for-tone: the same 5 tones (teal/gold/success/error/neutral), the
/// same status→tone mapping, and the same "10-18% tint background, solid
/// text" look, not just a vaguely similar color.
class StatusTone {
  final Color background;
  final Color foreground;
  const StatusTone(this.background, this.foreground);
}

StatusTone statusTone(String status) {
  switch (status.toLowerCase()) {
    case 'confirmed':
    case 'upcoming':
    case 'serving':
    case 'responded':
      return StatusTone(AppColors.teal.withValues(alpha: 0.14), AppColors.tealDark);
    case 'completed':
    case 'paid':
    case 'active':
    case 'approved':
    case 'resolved':
    case 'verified':
    case 'running':
      return StatusTone(AppColors.success.withValues(alpha: 0.12), AppColors.success);
    case 'cancelled':
    case 'rejected':
    case 'no_show':
    case 'pending_payment':
    case 'on_hold':
    case 'open':
    case 'failed':
    case 'disabled':
      return StatusTone(AppColors.danger.withValues(alpha: 0.1), AppColors.danger);
    case 'pending':
    case 'waiting':
    case 'called':
    case 'in_consultation':
    case 'paused':
    case 'in_review':
    case 'in_progress':
    case 'partial':
    case 'processing':
    case 'queued':
      return StatusTone(AppColors.gold.withValues(alpha: 0.18), AppColors.goldDark);
    default:
      return const StatusTone(AppColors.background, AppColors.textSecondary);
  }
}

/// Kept for any existing call site that wants a single solid color (e.g. an
/// icon tint) rather than the full background+foreground pair — delegates to
/// [statusTone] so both stay in sync with the web app's mapping.
Color statusColor(String status) => statusTone(status).foreground;
