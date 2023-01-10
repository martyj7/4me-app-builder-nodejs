const $ = ITRP.$;            // jQuery
const $extension = $(this);  // The UI Extension container with custom HTML

const multiText = function () {
  return {
    fieldId: null,
    required: false,
    maxNrOfTexts: null,
    $richText: null,
    $tracks: null,
    texts: [],

    init: function (fieldId, options) {
      options = options || {};
      this.fieldId = fieldId;
      this.required = !!options.required;
      this.maxNrOfTexts = options.max;
      this.$richText = $extension.find('#' + this.fieldId);
      this.singularName = options.singularName || this.fieldLabel();
      this.$tracks = this.appendTracksRow();
      this.texts = this.parseTexts();
      this.renderAddLink();
      this.renderTracks();
      this.textsUpdated();
    },

    fieldLabel: function () {
      const $row = this.$richText.closest('.row');
      return $row.find('label').attr('title');
    },

    appendTracksRow: function () {
      const title = this.fieldLabel();
      const $row = this.$richText.closest('.row');
      $('<div class="row vertical"><label title="' + title + '">' + title + '</label> <div class="tracks multitrack ' + this.fieldId + '"></div></div>').insertAfter($row);
      return $extension.find('.tracks.' + this.fieldId);
    },

    parseTexts: function () {
      return this.compact((this.$richText.val() || '').split(/\s*^\s*\*\s+/m));
    },

    compact: function (array) {
      return array.filter(function (n) {
        return !String.isBlank(n);
      });
    },

    renderAddLink: function () {
      const title = 'Add ' + this.singularName + '…';
      const $add = $('<a class="js-link-records" href="#"><i class="ii icon-add" title="' + title + '" role="img"></i><span>' + title + '</span></a>');
      this.$tracks.append($add);
      $add.on('click', function () {
        this.renderTrack('');
        return false; // prevent URL change, needed since this is an `a`
      }.bind(this));
    },

    nrOfTexts: function() {
      return this.$tracks.find('.track').length;
    },

    checkMaxTexts: function() {
      if (this.maxNrOfTexts) {
        this.$tracks.find('a.js-link-records').toggleClass('hide', this.nrOfTexts() >= this.maxNrOfTexts);
      }
    },

    textsUpdated: function () {
      this.texts = this.compact(this.$tracks.find('input.text').map(function () {
        return $(this).val();
      }).get());
      if (this.texts.length === 0) {
        this.$richText.val('');
      } else {
        this.$richText.val({ html: '<ul>' + this.texts.map(function (i) { return '<li>' + i + '</li>'; }).join('') + '</ul>' });
      }
      if (this.nrOfTexts() === 0) {
        this.renderTrack('');
      }
      if (this.required) {
        this.$tracks.find('input.text').first().toggleClass('required', this.texts.length === 0);
      }
    },

    renderTrack: function (text) {
      const title = 'Remove ' + this.singularName;
      const $track = $('<div class="track"><i class="ii icon-remove" title="' + title + '" aria-label="' + title + '" role="button" tabindex="0"></i><span class="item"><input class="txt text" type="text"/></span></div>');
      $track.insertBefore(this.$tracks.find('a.js-link-records'));
      $track.find('i.icon-remove')
        .on('click', function(e) { this.removeTrack(e.target); }.bind(this))
        .on('keypress', function(e) {
          if (e.which === 13) {
            this.removeTrack(e.target);
          }
        }.bind(this));

      $track.find('input')
        .on('keyup', function() { this.textsUpdated(); }.bind(this))
        .on('blur', function() { this.textsUpdated(); }.bind(this))
        .on('keypress', function(e) {
          if (e.which === 13 && e.target === this.$tracks.find('input.text').last()[0]) {
            if (!this.$tracks.find('a.js-link-records').hasClass('hide')) {
              this.renderTrack('');
            }
          }
        }.bind(this))
        .val(text)
        .focus();
      this.checkMaxTexts();
    },

    removeTrack: function (trackRemoveButton) {
      $(trackRemoveButton).closest('.track').remove();
      this.textsUpdated();
      this.checkMaxTexts();
    },

    renderTracks: function () {
      if (this.texts.length === 0) {
        this.renderTrack('');
      } else {
        this.texts.forEach(function (text) { this.renderTrack(text); }.bind(this));
      }
    },
  };
};


ITRP.hooks.register('after-prefill', function () {

  multiText().init('site_list', { singularName: 'site', required: true, max: 50 });
  const $sitehandling = $extension.find('#site_handling');
  const $sites = $extension.find('.tracks.site_list').closest('.row');
  $sitehandling.on('change', function() {
    $sites.toggleClass('hide', ($sitehandling.val() === 'all' || $sitehandling.val() === 'sites_with_assets'));
  }).trigger('change');

  multiText().init('asset_types', { singularName: 'asset type', required: true, max: 99 });
  const $importType = $extension.find('#import_type');
  const $assetTypes = $extension.find('.tracks.asset_types').closest('.row');
  $importType.on('change', function() {
    $assetTypes.toggleClass('hide', $importType.val() !== 'selected_types_only');
  }).trigger('change');

  $extension.find('last_synced_section').addClass('hide');

  $('input[type="radio"]').on('click', function (optionSelected) {
  $extension.find('.token-selected').toggleClass('hide', optionSelected.currentTarget.value !== 'export_token');
  $extension.find('.client-selected').toggleClass('hide', optionSelected.currentTarget.value !== 'api_client');
  }).trigger('click');

  const $connection_status = $extension.find('#connection_status');
  const $selectOption = $extension.find('#select_option');
  const $export_secret = $extension.find('#export_secret');
  const $client_id = $extension.find('#client_id');
  const $client_secret = $extension.find('#client_secret');
  const $orgName = $extension.find('#org_name');
  const $url = $extension.find('#runzero_url');

  if ($client_secret.val()) {
    $('.selection :radio[value=api_client]').prop("checked", true).trigger('click');
    $export_secret.val("");
  }else if ($export_secret.val()) {
    $('.selection :radio[value=export_token]').prop("checked", true).trigger('click');
    $client_id.val("");
    $client_secret.val("");
    $orgName.val("");
  }
  
  if ($connection_status.val() === 'pending_client_credentials') {
    $extension.find('.step-client-credentials').removeClass('hide');
    const nextStep = function () {
      var step = 'pending_client_credentials';
      if ($selectOption.val() == 'export_token' && !String.isBlank($export_secret.val())) {
        step = 'pending_authorization';
      } else if ($selectOption.val() == 'api_client' && !String.isBlank($client_secret.val()) && !String.isBlank($client_id.val()) && !String.isBlank($orgName.val())) {
        step = 'pending_authorization';
      }
      $connection_status.val(step);
    };
    $client_id.on('change', nextStep);
    $client_secret.on('change', nextStep);
    $url.on('change', nextStep);
    $orgName.on('change', nextStep);
  }

  if ($connection_status.val() === 'pending_authorization') {
    $extension.find('.step-authorize').removeClass('hide');
    if ($extension.find('#export_secret').val()) {
      $extension.find('.token-selected').toggleClass('hide', false);
      $('.selection :radio[value=export_token]').prop("checked", true).trigger('click');
    } else {
      $extension.find('.client-selected').toggleClass('hide', false);
      $('.selection :radio[value=api_client]').prop("checked", true).trigger('click');
    }
  }
});
