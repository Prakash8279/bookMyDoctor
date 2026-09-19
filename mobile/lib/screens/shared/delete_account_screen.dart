import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api_client.dart';
import '../../state/auth_provider.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';

/// COMPLETENESS FIX (audit Priority 3 #7 — mobile parity, Play Store policy-relevant): mirrors
/// web's `/delete-account` page (AccountDeletion.jsx), which exists specifically because Play
/// Store requires an in-app (or at least reachable-without-a-browser) account-deletion path for
/// any app that supports account creation. Web's page is itself a request-based flow (not
/// automated self-serve deletion) that reuses the public `POST /contact` endpoint so the request
/// lands in the same admin-reviewed Contact inbox, tagged with a fixed subject — this screen does
/// the same, pre-filled from the signed-in account since (unlike web's logged-out public page)
/// this is always reached from inside a logged-in session.
class DeleteAccountScreen extends StatefulWidget {
  const DeleteAccountScreen({super.key});

  @override
  State<DeleteAccountScreen> createState() => _DeleteAccountScreenState();
}

class _DeleteAccountScreenState extends State<DeleteAccountScreen> {
  static const _retainedItems = [
    'Financial and payment records we are required to keep for accounting, tax, or audit purposes.',
    "A clinic's own clinical notes and records for consultations you completed with them — these are the treating clinic's independent recordkeeping obligation, separate from your BookMyDoctor24 account.",
    'Information relevant to an open dispute, complaint, or investigation, until it is resolved.',
  ];

  final _reasonController = TextEditingController();
  bool _confirmed = false;
  bool _submitting = false;
  bool _sent = false;
  String? _error;

  @override
  void dispose() {
    _reasonController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_confirmed) {
      setState(() => _error = 'Please confirm the checkbox below before submitting — this tells us you understand deletion cannot be undone.');
      return;
    }
    setState(() {
      _submitting = true;
      _error = null;
    });
    final auth = context.read<AuthProvider>();
    final user = auth.user;
    final messageLines = [
      'Account email to delete: ${user?.email ?? ''}',
      if (auth.role.isNotEmpty) 'Account type: ${auth.role}',
      if (_reasonController.text.trim().isNotEmpty) 'Reason (optional): ${_reasonController.text.trim()}',
      'Confirmation: user has confirmed they understand this request is permanent, subject to the retained-records exceptions described on the deletion request screen.',
    ];
    try {
      await ApiClient.instance.post('/contact', body: {
        'name': user?.name ?? 'Account deletion request',
        'email': user?.email ?? '',
        'subject': 'Account & data deletion request',
        'message': messageLines.join('\n'),
      });
      if (mounted) setState(() => _sent = true);
    } catch (err) {
      if (mounted) {
        setState(() {
          _error = err.toString();
          _submitting = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Delete my account')),
      body: ListView(
        padding: const EdgeInsets.all(AppSpacing.md),
        children: [
          // Mirrors web's AccountDeletion.jsx: kicker "Account settings", h1 "Request account &
          // data deletion" — its own lede paragraph is kept below as the existing body text
          // rather than duplicated into PageHeader's one-line subtitle.
          const PageHeader(kicker: 'Account settings', title: 'Request account & data deletion'),
          if (_sent)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: AppSpacing.lg),
              child: Column(
                children: [
                  const Icon(Icons.check_circle_outline, size: 48, color: AppColors.success),
                  const SizedBox(height: AppSpacing.md),
                  const Text(
                    'Request received. Our team will verify and process it, and may contact you at your account '
                    'email if we need to confirm your identity first.',
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  OutlinedButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Back to profile')),
                ],
              ),
            )
          else ...[
                const Text(
                  'You can request deletion of your BookMyDoctor24 account and the personal data associated with '
                  'it, whether or not you still have the app installed. Simply uninstalling the app does not '
                  'delete your account or your data — please submit a request below.',
                  style: TextStyle(color: AppColors.textSecondary),
                ),
                const SizedBox(height: AppSpacing.md),
                SectionCard(
                  title: 'What happens after you submit a request',
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Our team verifies the request against your account email, then deletes your account and '
                        'associated personal data within 30 days. A few things are kept even after deletion, for '
                        'legal or recordkeeping reasons:',
                      ),
                      const SizedBox(height: AppSpacing.sm),
                      for (final item in _retainedItems)
                        Padding(
                          padding: const EdgeInsets.only(bottom: AppSpacing.xs),
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text('•  '),
                              Expanded(child: Text(item, style: const TextStyle(fontSize: 13))),
                            ],
                          ),
                        ),
                    ],
                  ),
                ),
                const SizedBox(height: AppSpacing.md),
                if (_error != null) ...[ErrorBanner(error: _error!), const SizedBox(height: AppSpacing.md)],
                TextField(
                  controller: _reasonController,
                  decoration: const InputDecoration(
                    labelText: 'Reason (optional)',
                    hintText: 'Helps us improve, does not affect your request',
                    alignLabelWithHint: true,
                  ),
                  maxLines: 3,
                ),
                const SizedBox(height: AppSpacing.md),
                CheckboxListTile(
                  contentPadding: EdgeInsets.zero,
                  controlAffinity: ListTileControlAffinity.leading,
                  value: _confirmed,
                  onChanged: (v) => setState(() => _confirmed = v ?? false),
                  title: const Text(
                    'I understand this permanently deletes my BookMyDoctor24 account and associated personal data '
                    '(subject to the exceptions above), and this cannot be undone.',
                    style: TextStyle(fontSize: 13),
                  ),
                ),
                const SizedBox(height: AppSpacing.md),
                PrimaryButton(label: 'Submit deletion request', onPressed: _submit, loading: _submitting),
              ],
          // Mirrors AccountDeletion.jsx's closing "Prefer email?" note, pointing at the same
          // inbox this form's request lands in via POST /contact.
          const Padding(
            padding: EdgeInsets.only(top: AppSpacing.lg),
            child: Divider(),
          ),
          Padding(
            padding: const EdgeInsets.only(top: AppSpacing.sm),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Prefer email? Send the same details to bookmydoctor24@gmail.com with the subject '
                  '"Account & data deletion request".',
                  style: TextStyle(color: AppColors.textSecondary, fontSize: 13),
                ),
                Align(
                  alignment: Alignment.centerLeft,
                  child: TextButton(
                    onPressed: () => launchUrl(Uri(
                      scheme: 'mailto',
                      path: 'bookmydoctor24@gmail.com',
                      query: 'subject=${Uri.encodeComponent('Account & data deletion request')}',
                    )),
                    child: const Text('Email bookmydoctor24@gmail.com'),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
