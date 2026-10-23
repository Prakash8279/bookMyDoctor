import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:connect_mobile/screens/shared/privacy_screen.dart';
import 'package:connect_mobile/screens/shared/terms_screen.dart';
import 'package:connect_mobile/screens/shared/legal_policies_screen.dart';

void main() {
  testWidgets('public privacy and terms reuse current shared copy, not the obsolete app draft', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: PrivacyScreen()));
    final privacy = tester.widget<LegalDocumentScreen>(find.byType(LegalDocumentScreen));
    expect(privacy.sections, same(kPrivacySections));
    expect(privacy.lastUpdated, '21 September 2026');
    expect(privacy.sections.expand((row) => row).join(' '), isNot(contains('[FILL:')));
    expect(find.textContaining('placeholder'), findsNothing);
    await tester.pumpWidget(const MaterialApp(home: TermsScreen()));
    final terms = tester.widget<LegalDocumentScreen>(find.byType(LegalDocumentScreen));
    expect(terms.sections, same(kTermsSections));
    expect(terms.sections.length, 10);
    expect(find.textContaining('Draft placeholder'), findsNothing);
    expect(tester.takeException(), isNull);
  });
}
