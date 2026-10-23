import 'package:flutter/material.dart';

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

  static const primary =
      Color(0xFFAD5D3B); // web tailwind.config.js colors.primary.DEFAULT
  static const primaryDark = Color(0xFF8E482D); // colors.primary.dark
  static const primaryLight = Color(0xFFF5E9E3); // colors.primary.light
  static const primaryContrast = Color(0xFF7F422D); // colors.primary.contrast
  static const teal = Color(0xFFC17655); // colors.teal.DEFAULT
  static const tealDark = Color(0xFF8E482D); // colors.teal.dark
  static const gold = Color(0xFFFFC107); // colors.gold.DEFAULT
  static const goldDark = Color(0xFFB77900); // colors.gold.dark
  static const charcoal =
      Color(0xFF1B1917); // colors.charcoal — web's sidebar/footer background
  static const background =
      Color(0xFFF8F6F3); // colors.surface — web's page background
  static const surface = Color(
      0xFFFFFFFF); // web cards sit on plain white over that page background
  static const textPrimary = Color(0xFF1D1B19); // colors.ink
  static const textSecondary = Color(0xFF6F6A64); // colors.muted
  static const border = Color(0xFFE9E5E0); // colors.border
  static const success = Color(0xFF198754); // colors.success
  static const warning = Color(
      0xFFFFC107); // same value as gold — web has no separate "warning" token
  static const danger = Color(0xFFDC3545); // colors.error
  static const info = Color(
      0xFF2563EB); // web has no blue "info" tone; kept only for any residual use
}

class AppSpacing {
  AppSpacing._();

  static const xs = 4.0;
  static const sm = 8.0;
  static const md = 16.0;
  static const lg = 24.0;
  static const xl = 32.0;
}

/// Semantic UI colours follow the nearest Theme, not a global mutable flag.
class AppPalette {
  const AppPalette(this.dark);
  final bool dark;
  static AppPalette of(BuildContext context) =>
      AppPalette(Theme.of(context).brightness == Brightness.dark);
  Color get background => dark ? const Color(0xFF0B0B0B) : AppColors.background;
  Color get surface => dark ? const Color(0xFF151515) : AppColors.surface;
  Color get textPrimary =>
      dark ? const Color(0xFFF5F5F5) : AppColors.textPrimary;
  Color get textSecondary =>
      dark ? const Color(0xFFB5B5B5) : AppColors.textSecondary;
  Color get border => dark ? const Color(0xFF363636) : AppColors.border;
  Color get primary => dark ? const Color(0xFFE0A080) : AppColors.primary;
  Color get primaryDark =>
      dark ? const Color(0xFFE9A88A) : AppColors.primaryDark;
  Color get primaryLight =>
      dark ? const Color(0xFF33251E) : AppColors.primaryLight;
  Color get primaryContrast =>
      dark ? const Color(0xFFF4C3A9) : AppColors.primaryContrast;
  Color get teal => dark ? const Color(0xFFE0A080) : AppColors.teal;
  Color get tealDark => primaryDark;
  Color get goldDark => dark ? const Color(0xFFFFD166) : AppColors.goldDark;
  Color get success => dark ? const Color(0xFF5ACD9C) : AppColors.success;
  Color get danger => dark ? const Color(0xFFFF8294) : AppColors.danger;
  Color get info => dark ? const Color(0xFF8AB4F8) : AppColors.info;

  Color lightSurface(Color original) => dark ? surface : original;
  Color lightBorder(Color original) => dark ? border : original;
  Color lightMuted(Color original) => dark ? textSecondary : original;
}

extension AppPaletteContext on BuildContext {
  AppPalette get palette => AppPalette.of(this);
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

  static ThemeData get dark => _build(Brightness.dark);
  static ThemeData get light => _build(Brightness.light);

  static ThemeData _build(Brightness brightness) {
    final palette = AppPalette(brightness == Brightness.dark);
    // web's actual rendered font stack is just Inter everywhere (reference_site.css's one
    // `font-family:Inter,...` base rule) — tailwind.config.js also declares a 'heading' family
    // (Poppins) but no component in the codebase ever applies it, so porting it here would be
    // matching a font the website itself never shows.
    final textTheme =
        ThemeData(brightness: brightness, fontFamily: 'Inter').textTheme;

    final base = ThemeData(
      useMaterial3: true,
      colorScheme: ColorScheme.fromSeed(
        seedColor: AppColors.primary,
        primary: AppColors.primary,
        secondary: AppColors.teal,
        error: AppColors.danger,
        brightness: brightness,
      ),
      scaffoldBackgroundColor: palette.background,
      fontFamily: 'Inter',
    );

    return base.copyWith(
      iconTheme: IconThemeData(color: palette.textPrimary),
      bottomSheetTheme: BottomSheetThemeData(backgroundColor: palette.surface),
      dialogTheme: DialogThemeData(backgroundColor: palette.surface),
      snackBarTheme: SnackBarThemeData(
          backgroundColor: palette.textPrimary,
          contentTextStyle: TextStyle(color: palette.background)),
      textTheme: textTheme.apply(
        bodyColor: palette.textPrimary,
        displayColor: palette.textPrimary,
      ),
      appBarTheme: AppBarTheme(
        backgroundColor: palette.background,
        foregroundColor: palette.textPrimary,
        elevation: 0,
        centerTitle: false,
        surfaceTintColor: Colors.transparent,
        titleTextStyle: TextStyle(
          fontFamily: 'Inter',
          color: palette.textPrimary,
          fontSize: 18,
          fontWeight: FontWeight.w700,
        ),
      ),
      cardTheme: CardThemeData(
        color: palette.surface,
        elevation: 1,
        shadowColor: AppColors.charcoal.withValues(alpha: 0.12),
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadius.card),
          side: BorderSide(color: palette.border),
        ),
        margin: EdgeInsets.zero,
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: palette.surface,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppRadius.button),
          borderSide: BorderSide(color: palette.border),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppRadius.button),
          borderSide: BorderSide(color: palette.border),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppRadius.button),
          borderSide: const BorderSide(color: AppColors.primary, width: 1.5),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppRadius.button),
          borderSide: const BorderSide(color: AppColors.danger),
        ),
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: AppColors.primary,
          foregroundColor: Colors.white,
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
          shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(AppRadius.button)),
          textStyle:
              const TextStyle(fontFamily: 'Inter', fontWeight: FontWeight.w600),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: palette.textPrimary,
          side: BorderSide(color: palette.border),
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
          shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(AppRadius.button)),
        ),
      ),
      popupMenuTheme: PopupMenuThemeData(
        color: palette.surface,
        surfaceTintColor: Colors.transparent,
        elevation: 6,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: BorderSide(color: palette.border),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(foregroundColor: palette.primaryDark),
      ),
      chipTheme: base.chipTheme.copyWith(
        selectedColor: palette.primaryLight,
        labelStyle: TextStyle(color: palette.textPrimary),
        secondarySelectedColor: palette.primaryLight,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
        side: BorderSide(color: palette.border),
      ),
      dividerTheme: DividerThemeData(color: palette.border, thickness: 1),
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

StatusTone statusTone(String status, {bool dark = false}) {
  final palette = AppPalette(dark);
  switch (status.toLowerCase()) {
    case 'confirmed':
    case 'upcoming':
    case 'serving':
    case 'responded':
      return StatusTone(
          AppColors.teal.withValues(alpha: 0.14), palette.tealDark);
    case 'completed':
    case 'paid':
    case 'active':
    case 'approved':
    case 'resolved':
    case 'verified':
    case 'running':
      return StatusTone(
          AppColors.success.withValues(alpha: 0.12), palette.success);
    case 'cancelled':
    case 'rejected':
    case 'no_show':
    case 'pending_payment':
    case 'on_hold':
    case 'open':
    case 'failed':
    case 'disabled':
      return StatusTone(
          AppColors.danger.withValues(alpha: 0.1), palette.danger);
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
      return StatusTone(
          AppColors.gold.withValues(alpha: 0.18), palette.goldDark);
    default:
      return StatusTone(palette.background, palette.textSecondary);
  }
}

/// Kept for any existing call site that wants a single solid color (e.g. an
/// icon tint) rather than the full background+foreground pair — delegates to
/// [statusTone] so both stay in sync with the web app's mapping.
Color statusColor(String status) => statusTone(status).foreground;
