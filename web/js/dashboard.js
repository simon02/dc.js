// define the charts we will be working with
var lineChart = dc.compositeChart("#items_in_time");
var pieChart = dc.pieChart("#items_pie");

d3.json("tweets_per_hour.json", function(error, experiments) {

  // Variable that will be used to calculate running totals for multiple fields for the tweets
  var urls = {};

  experiments.forEach(function(d) {
    d.date = new Date((d.created_at || 0) * 1000);
    // allow us to group by hour or by day
    d.hour = d3.time.hour(d.date);
    d.day  = d3.time.day(d.date);

    /**
      For each record we calculate a running total of shares and views.
      We also calculate without own media (here hard-coded as tweets from 'vrtderedactie')
      as this otherwise skews graphs and makes it difficult to view the impact of individual shares.
      */
    urls[d.url] = urls[d.url] || { shares: 0, views: 0, shares_ex: 0, views_ex: 0 }
    var ownMedia = d.screen_name == "vrtderedactie";
    /*
      The data was hand generated to include an 'empty' row for each hour, these tweets do not have the field followers.
      We had to include an empty row for each hour, to be able to get a visually pleasing result with compositechart
      (otherwise you would only see spikes for timeframes that contain a value and the graph would drop to 0 for timeframes that don't).
      => previously tried out serieschart where this was not necessary - see dashboard_test_old.html.

      This will also allow us to create a summarized total line in the graph (see composite_test.html),
      but it requires the data to be cleaned up a little more (only 1 row per hour instead of multiple).
     */
    if (d.followers) {
      d.shares = urls[d.url].shares += 1;
      d.views = urls[d.url].views += d.followers;
      d.shares_ex = urls[d.url].shares_ex += (ownMedia ? 0 : 1);
      d.views_ex = urls[d.url].views_ex += (ownMedia ? 0 : d.followers);
      d.followers_ex = ownMedia ? 0 : d.followers;
      d.count = 1;
      d.count_ex = ownMedia ? 0 : 1;
    } else {
      d.shares = urls[d.url].shares;
      d.views = urls[d.url].views;
      d.shares_ex = urls[d.url].shares_ex;
      d.views_ex = urls[d.url].views_ex;
      d.followers = d.followers_ex = d.count = d.count_ex = 0;
    }
  });

  // set this variable up for garbage collection
  urls = null;

  // define the crossfilter-based variables
  var ndx           = crossfilter(experiments),
      dateDimension = ndx.dimension(dc.pluck("hour")),
      urlDimension  = ndx.dimension(dc.pluck("url")),
      urlSumGroup   = urlDimension.group().reduceSum(function(d) {
        // as mentioned before, using this mock-up data, not all rows contain the field followers - these are just filler rows
        return d.followers || 0;
      });

  // Multiple graph tooltips based on the d3-tip library
  var tip = d3.tip()
    .attr('class', 'd3-tip')
    .offset([-10, 0])
    .html(function (d) {
      return "<span class='key'>" +  d.x.toLocaleString() + "</span><span class='value'>"  + d.y + "</span>";
    });
  var pieTip = d3.tip()
    .attr('class', 'd3-tip')
    .direction('s')
    .offset([-10, 0])
    .html(function (d) {
      return "<span class='key'>Item {0}:</span><span class='value'>{1}</span>".format(links[d.data.key].position, d.value);
    });

  // draw the charts using the default variables
  drawLineChart([], "views_ex", false, true); // this will show the outlines of the (empty) chart
  drawPieChart("views");
  // actually render the charts - otherwise they will not appear!
  dc.renderAll();

  // set the tooltip for the piechart
  d3.selectAll("g.pie-slice").call(pieTip);
  d3.selectAll("g.pie-slice").on('mouseover', pieTip.show)
      .on('mouseout', pieTip.hide);

  function drawLineChart(articles, countField, renderArea, rerender) {
    if (!rerender)
      rerender = false;
    var charts = articles.map(function(chart) {
      var title = links[chart].title;
      if (title.length > 25)
        title = title.substr(0,25) + "...";
      return dc.lineChart(lineChart)
        .group(groupOnUrl(dateDimension.group(), chart, countField), title);
        // .group(dateDimension.group().reduceSum(function(d) { return customFilter(d, chart, countField) }), chart);
    });
    lineChart
      .width(1000)
      .height(400)
      .x(d3.time.scale().domain([experiments[0].day, experiments[experiments.length - 1].hour]))
      .elasticY(true)
      .elasticX(true)
      .renderHorizontalGridLines(true)
      .brushOn(false)
      .shareColors(true)
      .compose(charts)
      .childOptions({
        renderDataPoints: true,
        renderArea: renderArea || false,
        dimension: dateDimension
      })
      .legend(dc.legend().x(40).y(10))
      .yAxis().tickFormat(d3.format("s"));
    if (rerender)
      lineChart.render();
    else
      lineChart.redraw();

    if (articles.length > 0) {
      d3.selectAll("g .dot").call(tip);
      d3.selectAll("g .dot").on('mouseover', tip.show)
        .on('mouseleave', tip.hide);
    }
  }

  function drawPieChart(field) {
    pieChart
      .width(400)
      .height(400)
      .slicesCap(10)
      .innerRadius(50)
      .dimension(urlDimension)
      .group(urlDimension.group().reduceSum(dc.pluck(field)))
      .othersGrouper(false)
      .ordering(function(d,e) {
        return links[d.key].position;
      })
      .label(function(d) {
        return links[d.key].position;
      })
      .minAngleForLabel(0);
    pieChart.redraw();
  }

  /**
    If the data was correctly set up, we could use this short function as a custom crossfilter grouping filter
    to only keep the values of a single/multiple series.

    If values is an array, it will summarize those series.
    */
  function groupSeriesFilter(d, values, field) {
    if (values instanceof Array)
      return $.inArray(d.url, values) > -1 ? d[field] : 0;
    else if (d.url == values)
      return d[field];
    return 0;
  }

  /**
    Extension based on groupSeriesFilter to work with the current mock dataset.
    As it is possible that there are multiple rows within the same timeframe (an hour),
    we only want to keep the last value contained in field (which is normally a running total).
   */
  function groupOnUrl(group, values, field) {
    return group.reduce(
      function(p, v) {
        if (values instanceof Array)
          return $.inArray(v.url, values) > -1 ? v[field] : p;
        else if (v.url == values)
          return v[field];
        return p;
      },
      function(p, v) {
        if (values instanceof Array)
          return $.inArray(v.url, values) > -1 ? v[field] : p;
        else if (v.url == values)
          return v[field];
        return p;
      },
      function() {
        return 0;
      }
    );
  }

  var articles = [],
      includeOwnMedia = true,
      renderArea = false,
      type = "views";

  $.each(links, function(i, link) {
    $("#content_items").append($("<div>")
        .addClass("article")
        .append($("<label>")
          .addClass("title")
          .text(link.position + ". " + link.title)
          .prepend($("<input>")
            .attr({
              "type": "checkbox",
              "value": i
            })
            .click(function() {
              var value = $(this).val();
              $("#abstract_article h4").text(link.title);
              $("#abstract_article .text").text(link.abstract);
              $("#abstract_article a").text("bekijk artikel").attr("href",value);
              if ($(this).prop("checked")) {
                articles.push(value);
              }
              else {
                var index = $.inArray(value, articles);
                if (index >= 0)
                  articles.splice(index, 1);
              }
              lineChart.resetSvg();
              drawLineChart(articles, type + (includeOwnMedia ? "" : "_ex"), renderArea, true);
            })
          )
        )
      )
  });

  $("#graph_option_count").change(function() {
    if ($(this).val() === "views") {
      type = "views"
    }
    if ($(this).val() === "count") {
      type = "shares"
    }
    drawLineChart(articles, type + (includeOwnMedia ? "" : "_ex"), renderArea, true);
    drawPieChart(pieField());
  });
  $("#graph_option_fill").change(function() {
    renderArea = $(this).val() == 1;
    drawLineChart(articles, type + (includeOwnMedia ? "" : "_ex"), renderArea, true);
    drawPieChart(pieField());
  });

  $("#include_own_media").change(function() {
    includeOwnMedia = $(this).prop("checked");
    drawLineChart(articles, type + (includeOwnMedia ? "" : "_ex"), renderArea, true);
    drawPieChart(pieField());
  })

  function pieField() {
    var field = type == "views" ? "followers" : "count";
    if (!includeOwnMedia)
      field += "_ex";
    return field;
  }
});
