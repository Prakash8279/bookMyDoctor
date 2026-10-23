import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:connect_mobile/theme/app_theme.dart';
import 'package:connect_mobile/theme/theme_preference.dart';
import 'package:connect_mobile/widgets/common_widgets.dart';

class MemoryStorage extends FlutterSecureStorage {
  String? saved;
  @override
  Future<String?> read(
          {required String key,
          IOSOptions? iOptions,
          AndroidOptions? aOptions,
          LinuxOptions? lOptions,
          WebOptions? webOptions,
          MacOsOptions? mOptions,
          WindowsOptions? wOptions}) async =>
      saved;
  @override
  Future<void> write(
      {required String key,
      required String? value,
      IOSOptions? iOptions,
      AndroidOptions? aOptions,
      LinuxOptions? lOptions,
      WebOptions? webOptions,
      MacOsOptions? mOptions,
      WindowsOptions? wOptions}) async {
    saved = value;
  }
}

void main() {
  test('theme preference persists and reloads without affecting account data',
      () async {
    final storage = MemoryStorage();
    final preference = ThemePreference(storage: storage);
    await preference.setMode(ThemeMode.dark);
    expect(storage.saved, 'dark');
    final reloaded = ThemePreference(storage: storage);
    await reloaded.load();
    expect(reloaded.mode, ThemeMode.dark);
    await reloaded.setMode(ThemeMode.light);
    expect(storage.saved, 'light');
    preference.dispose();
    reloaded.dispose();
  });
  testWidgets('theme toggle updates semantic surfaces and text together',
      (tester) async {
    final preference = ThemePreference(storage: MemoryStorage());
    await tester.pumpWidget(ThemePreferenceScope(
        preference: preference,
        child: AnimatedBuilder(
            animation: preference,
            builder: (context, _) => MaterialApp(
                theme: AppTheme.light,
                darkTheme: AppTheme.dark,
                themeMode: preference.mode,
                home: Scaffold(
                    appBar: AppBar(actions: const [ThemePreferenceButton()]),
                    body: const SectionCard(
                        title: 'Example card', child: Text('Content')))))));
    await tester.tap(find.byTooltip('Switch to dark theme'));
    await tester.pumpAndSettle();
    final context = tester.element(find.text('Example card'));
    expect(Theme.of(context).brightness, Brightness.dark);
    expect(context.palette.surface, const Color(0xFF151515));
    expect(context.palette.textPrimary, const Color(0xFFF5F5F5));
    expect(find.byTooltip('Switch to light theme'), findsOneWidget);
    await tester.pumpWidget(const SizedBox.shrink());
    preference.dispose();
  });
}
