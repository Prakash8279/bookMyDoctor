import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show SystemNavigator;
import 'package:provider/provider.dart';

import '../state/auth_provider.dart';
import '../theme/app_theme.dart';

class RoleNavItem {
  final IconData icon;
  final String label;
  final Widget Function(BuildContext context) builder;
  const RoleNavItem({required this.icon, required this.label, required this.builder});
}

/// Shared shell for every role portal — a drawer listing that role's
/// sections (mirrors the web app's sidebar), an app bar showing the
/// section title + interactive profile and notification actions matching
/// web's PortalHeader, and back-navigation handling via PopScope to prevent
/// closing the app accidentally.
class RoleScaffold extends StatefulWidget {
  final String portalTitle;
  final List<RoleNavItem> items;
  final int initialIndex;

  const RoleScaffold({
    super.key,
    required this.portalTitle,
    required this.items,
    this.initialIndex = 0,
  });

  static RoleScaffoldState? of(BuildContext context) {
    return context.findAncestorStateOfType<RoleScaffoldState>();
  }

  @override
  State<RoleScaffold> createState() => RoleScaffoldState();
}

class RoleScaffoldState extends State<RoleScaffold> {
  late int _index = widget.initialIndex;
  final List<int> _history = [0];
  final GlobalKey<ScaffoldState> _scaffoldKey = GlobalKey<ScaffoldState>();
  DateTime? _lastBackPressTime;

  void navigateTo(int i) {
    if (i < 0 || i >= widget.items.length) return;
    if (_index == i) return;
    setState(() {
      _history.add(i);
      _index = i;
    });
  }

  bool navigateToLabel(String label) {
    final needle = label.toLowerCase().trim();
    final idx = widget.items.indexWhere(
      (it) => it.label.toLowerCase().contains(needle),
    );
    if (idx != -1) {
      navigateTo(idx);
      return true;
    }
    return false;
  }

  void _navigateTo(int i) => navigateTo(i);

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final current = widget.items[_index];
    final displayName = auth.user?.name.isNotEmpty == true ? auth.user!.name : 'Account';
    final initials = displayName.trim().isNotEmpty ? displayName.trim()[0].toUpperCase() : '?';

    final profileIndex = widget.items.indexWhere((it) => it.label.toLowerCase().contains('profile'));
    final notificationsIndex = widget.items.indexWhere((it) => it.label.toLowerCase().contains('notification'));

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, result) {
        if (didPop) return;
        if (_scaffoldKey.currentState?.isDrawerOpen == true) {
          _scaffoldKey.currentState?.closeDrawer();
          return;
        }
        if (_history.length > 1) {
          _history.removeLast();
          setState(() => _index = _history.last);
          return;
        }
        if (_index != 0) {
          setState(() {
            _index = 0;
            _history.clear();
            _history.add(0);
          });
          return;
        }
        final now = DateTime.now();
        if (_lastBackPressTime == null || now.difference(_lastBackPressTime!) > const Duration(seconds: 2)) {
          _lastBackPressTime = now;
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Press back again to exit BookMyDoctor24'),
              duration: Duration(seconds: 2),
            ),
          );
          return;
        }
        SystemNavigator.pop();
      },
      child: Scaffold(
        key: _scaffoldKey,
        appBar: AppBar(
          backgroundColor: Colors.white,
          elevation: 0,
          scrolledUnderElevation: 0,
          leading: IconButton(
            icon: const Icon(Icons.menu_rounded, color: AppColors.textPrimary),
            onPressed: () => _scaffoldKey.currentState?.openDrawer(),
            tooltip: 'Open navigation',
          ),
          title: Text(
            current.label,
            style: const TextStyle(color: AppColors.textPrimary, fontWeight: FontWeight.w700, fontSize: 18),
          ),
          bottom: PreferredSize(
            preferredSize: const Size.fromHeight(1),
            child: Container(color: AppColors.border, height: 1),
          ),
          actions: [
            if (notificationsIndex != -1)
              IconButton(
                icon: const Icon(Icons.notifications_none_rounded, color: AppColors.textPrimary, size: 22),
                onPressed: () => _navigateTo(notificationsIndex),
                tooltip: 'Notifications',
              ),
            Padding(
              padding: const EdgeInsets.only(right: AppSpacing.md, left: AppSpacing.xs),
              child: Tooltip(
                message: 'Open profile ($displayName)',
                child: InkWell(
                  onTap: profileIndex != -1 ? () => _navigateTo(profileIndex) : null,
                  borderRadius: BorderRadius.circular(999),
                  child: CircleAvatar(
                    radius: 17,
                    backgroundColor: AppColors.primaryLight,
                    child: Text(
                      initials,
                      style: const TextStyle(color: AppColors.primaryDark, fontWeight: FontWeight.w800, fontSize: 13),
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      drawer: Drawer(
        backgroundColor: AppColors.charcoal,
        child: SafeArea(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.md, AppSpacing.md, AppSpacing.sm),
                child: Row(
                  children: [
                    const ClipRRect(
                      borderRadius: BorderRadius.all(Radius.circular(11)),
                      child: Image(image: AssetImage('assets/branding/app_icon.png'), width: 36, height: 36),
                    ),
                    const SizedBox(width: AppSpacing.sm),
                    const Expanded(
                      child: Text(
                        'BookMyDoctor24',
                        style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 17),
                      ),
                    ),
                  ],
                ),
              ),
              Container(
                margin: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: AppSpacing.sm),
                padding: const EdgeInsets.symmetric(horizontal: AppSpacing.sm, vertical: AppSpacing.sm),
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.05),
                  borderRadius: BorderRadius.circular(AppRadius.button),
                  border: Border.all(color: Colors.white.withValues(alpha: 0.1)),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(widget.portalTitle, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 13)),
                    const SizedBox(height: 2),
                    Text(
                      displayName,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(color: Colors.white.withValues(alpha: 0.6), fontSize: 12),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.xs),
              Expanded(
                child: ListView.builder(
                  padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
                  itemCount: widget.items.length,
                  itemBuilder: (context, i) {
                    final item = widget.items[i];
                    final selected = i == _index;
                    return Padding(
                      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.sm, vertical: 1),
                      child: ListTile(
                        dense: true,
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.button)),
                        leading: Icon(item.icon, size: 20, color: selected ? Colors.white : Colors.white.withValues(alpha: 0.75)),
                        title: Text(
                          item.label,
                          style: TextStyle(
                            color: selected ? Colors.white : Colors.white.withValues(alpha: 0.75),
                            fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                            fontSize: 14,
                          ),
                        ),
                        selected: selected,
                        selectedTileColor: AppColors.primaryDark,
                        onTap: () {
                          Navigator.of(context).pop();
                          _navigateTo(i);
                        },
                      ),
                    );
                  },
                ),
              ),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: AppSpacing.sm),
                child: ListTile(
                  dense: true,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.button)),
                  leading: Icon(Icons.logout, size: 20, color: Colors.white.withValues(alpha: 0.75)),
                  title: Text('Sign out', style: TextStyle(color: Colors.white.withValues(alpha: 0.75), fontSize: 14)),
                  onTap: () async {
                    Navigator.of(context).pop();
                    await context.read<AuthProvider>().logout();
                  },
                ),
              ),
              const SizedBox(height: AppSpacing.sm),
            ],
          ),
        ),
      ),
      body: current.builder(context),
    ),
  );
}
}
